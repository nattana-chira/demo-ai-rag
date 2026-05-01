import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { RedisCacheService } from '../cache/redis-cache.service';
import {
  CreateMovieDto,
  CreateMovieSchema,
  MovieRecommendation,
} from './movie.interface';

@Injectable()
export class MovieService {
  private readonly RAG_QUERY_MIN_LEN = 2;
  private readonly RAG_QUERY_MAX_LEN = 300;
  private readonly SEARCH_CACHE_TTL_SECONDS = 60;
  private readonly RAG_CACHE_TTL_SECONDS = 120;
  private readonly BLOCKED_QUERY_PATTERNS: RegExp[] = [
    /ignore\s+(all|previous|prior)\s+instructions?/i,
    /reveal\s+(system|developer)\s+prompt/i,
    /bypass\s+(guardrails?|safety|restrictions?)/i,
    /jailbreak/i,
    /act\s+as\s+(?:a\s+)?(?:system|developer)/i,
    /do\s+anything\s+now/i,
  ];

  constructor(
    private prisma: PrismaService,
    private ai: AiService,
    private cache: RedisCacheService,
  ) {}

  async create(body: CreateMovieDto) {
    const parsed = CreateMovieSchema.parse(body);
    const { title, description, genre, year, rating, themes, mood } = parsed;

    // 1. Build rich text for embedding
    const embeddingInput = this.buildMovieText(body);

    // 2. Generate embedding
    const embedding = await this.ai.createEmbedding(embeddingInput);

    const vector = `[${embedding.join(',')}]`;

    // 3. Insert into DB
    await this.prisma.$executeRaw`
      INSERT INTO movies (
        id,
        title,
        description,
        genre,
        year,
        rating,
        themes,
        mood,
        embedding
      )
      VALUES (
        gen_random_uuid(),
        ${title},
        ${description},
        ${genre}::text[],
        ${year},
        ${rating},
        ${themes ?? []}::text[],
        ${mood ?? null},
        ${vector}::vector
      )
    `;

    return {
      success: true,
      message: 'Movie created successfully',
    };
  }

  async search(query: string): Promise<any[]> {
    const normalizedQuery = this.normalizeRagQuery(query);
    const searchCacheKey = this.getSearchCacheKey(normalizedQuery);
    const cachedResults = await this.cache.getJson<any[]>(searchCacheKey);
    if (cachedResults) {
      console.log('[MovieService] search cache hit');
      return cachedResults;
    }

    // 1. keyword search
    const keywordResults = await this.prisma.$queryRaw<any[]>`
      SELECT 
        id,
        ts_rank(search_vector, plainto_tsquery('english', ${normalizedQuery})) AS bm25_score
      FROM movies
      WHERE search_vector @@ plainto_tsquery('english', ${normalizedQuery})
      ORDER BY bm25_score DESC
      LIMIT 4;
    `;

    const bm25Map = new Map(
      keywordResults.map(r => [r.id, r.bm25_score])
    );
    const maxBm25 = Math.max(...bm25Map.values(), 1);

    // 2. convert query → embedding
    const queryEmbedding = await this.ai.createEmbedding(normalizedQuery);

    const vector = `[${queryEmbedding.join(',')}]`;

    // 3. vector search (get more candidates first)
    const movies = await this.prisma.$queryRaw<any[]>`
      SELECT 
        id,
        title,
        description,
        genre,
        year,
        rating,
        themes,
        mood,
        created_at,
        updated_at,
        embedding <-> ${vector}::vector AS distance
      FROM movies
      ORDER BY embedding <-> ${vector}::vector
      LIMIT 8;
    `;

    // 4. Ranking layer
    const ranked = movies.map((movie) => {
      const distance = Number(movie.distance);

      // vector clamp similarity (avoid negative values)
      const similarity = 1 / (1 + distance);

      // rating boost (0 → 1 scale)
      const ratingBoost = (movie.rating ?? 0) / 10;

      // theme boost (soft semantic overlap)
      const themeBoost = this.calculateTextOverlap(
        normalizedQuery,
        movie.themes ?? [],
      );

      // genre boost (simple keyword match, safe)
      const genreBoost =
        movie.genre?.some((g: string) =>
          normalizedQuery.toLowerCase().includes(g.toLowerCase())
        )
          ? 1
          : 0;

      // normalized BM25 (0–1 range)
      const bm25 = bm25Map.get(movie.id) ?? 0;
      const bm25Norm = bm25 / maxBm25;

      // final score (tuned simple weighting)
      const score =
        similarity * 0.6 +
        bm25Norm * 0.2 +
        ratingBoost * 0.1 +
        themeBoost * 0.05 +
        genreBoost * 0.05;

      return {
        ...movie,
        distance,
        similarity,
        score,
        raw: {
          similarity,
          bm25,
          ratingBoost,
          themeBoost,
          genreBoost
        },
        calculated: {
          similarity: similarity * 0.6,
          bm25Norm: bm25Norm * 0.2,
          ratingBoost: ratingBoost * 0.1,
          themeBoost: themeBoost * 0.05,
          genreBoost: genreBoost * 0.05
        }
      };
    });

    // 5. sort final results
    const finalResults = ranked
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    await this.cache.setJson(
      searchCacheKey,
      finalResults,
      this.SEARCH_CACHE_TTL_SECONDS,
    );
    return finalResults;
  }

  async ragSearch(query: string) {
    const safeQuery = this.normalizeRagQuery(query);
    if (!safeQuery) {
      return {
        query: '',
        answer: {
          recommendations: [],
          summary: 'Please provide a movie search query.',
        },
        results: [],
      };
    }

    if (this.isUnsafeRagQuery(safeQuery)) {
      console.log('[MovieService] Blocked unsafe RAG query');
      return {
        query: safeQuery,
        answer: {
          recommendations: [],
          summary:
            'Your query looks unsafe for AI generation. Please rephrase as a normal movie preference request.',
        },
        results: [],
      };
    }

    if (!this.isRagQueryLengthAllowed(safeQuery)) {
      console.log('[MovieService] Rejected out-of-range RAG query length');
      return {
        query: safeQuery.slice(0, this.RAG_QUERY_MAX_LEN),
        answer: {
          recommendations: [],
          summary: `Query length must be between ${this.RAG_QUERY_MIN_LEN} and ${this.RAG_QUERY_MAX_LEN} characters.`,
        },
        results: [],
      };
    }

    const ragCacheKey = this.getRagCacheKey(safeQuery);
    const cachedRag = await this.cache.getJson<{
      query: string;
      answer: MovieRecommendation;
      results: any[];
    }>(ragCacheKey);
    if (cachedRag) {
      console.log('[MovieService] ragSearch cache hit');
      return cachedRag;
    }

    // 1. retrieve
    const movies = await this.search(safeQuery);

    if (movies.length === 0) {
      return {
        query: safeQuery,
        answer: {
          recommendations: [],
          summary: 'No matching movies found. Try adding genre, mood, or theme keywords.',
        },
        results: [],
      };
    }

    // 2. build context
    const context = movies.slice(0, 5).map((m, i) => `
  ${i + 1}. ${this.safeField(m.title, 120)}
  Genres: ${this.safeField(m.genre?.join(', '), 150)}
  Themes: ${this.safeField(m.themes?.join(', '), 220)}
  Mood: ${this.safeField(m.mood, 80)}
  Description: ${this.safeField(m.description, 700)}
  `).join("\n");

    // 3. AI call via AiService (NOT direct)
    const rawAnswer = await this.ai.chatCompletionV2([
      {
        role: "system",
        content: `
  You are a movie expert recommendation assistant. Return ONLY valid JSON.
  Use ONLY provided movies.
  Do NOT invent data.
  Return 2–3 recommendations with explanation.
  Schema: {
    "recommendations": [{"title": string, "reason": string, "matchScore": number}],
    "summary": string
  }
        `,
      },
      {
        role: "user",
        content: `
  User query: ${safeQuery}

  Movies:
  ${context}
        `,
      },
    ]);

    const answer = this.applyRecommendationGuardrails(rawAnswer, movies);

    const response = {
      query: safeQuery,
      answer,
      results: movies,
    };
    await this.cache.setJson(ragCacheKey, response, this.RAG_CACHE_TTL_SECONDS);
    return response;
  }

  // helper: soft overlap
  private calculateTextOverlap(query: string, tags: string[]): number {
    if (!tags || tags.length === 0) return 0;

    // 1. normalize query
    const queryTokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 2); // remove noise words

    // 2. normalize tags
    const tagTokens = tags.map(t => t.toLowerCase());

    // 3. count matches
    let matchCount = 0;

    for (const tag of tagTokens) {
      for (const token of queryTokens) {
        if (token.includes(tag) || tag.includes(token)) {
          matchCount++;
          break;
        }
      }
    }

    // 4. normalize score (0 → 1)
    return matchCount / Math.max(tags.length, 1);
  }

  private buildMovieText(movie: CreateMovieDto) {
    return `
  Movie Title: ${movie.title}

  Plot:
  ${movie.description}

  Genres: ${movie.genre?.join(", ") ?? "unknown"}

  Themes: ${movie.themes?.join(", ") ?? "unknown"}

  Mood: ${movie.mood ?? "unknown"}

  Year: ${movie.year ?? "unknown"}
  Rating: ${movie.rating ?? "unknown"}

  Used for semantic movie search and recommendation system.
    `.trim();
  }

  // Keep the model output grounded, bounded, and UI-safe.
  private applyRecommendationGuardrails(
    answer: MovieRecommendation,
    retrievedMovies: any[],
  ): MovieRecommendation {
    const allowedTitles = new Set(
      retrievedMovies.map((m) => (m.title ?? '').toString().toLowerCase()),
    );

    const seen = new Set<string>();
    const recommendations = (answer?.recommendations ?? [])
      .filter((item) => {
        const title = item?.title?.toLowerCase()?.trim();
        return Boolean(title && allowedTitles.has(title) && !seen.has(title));
      })
      .map((item) => {
        const title = item.title.trim();
        const reason = item.reason.trim().slice(0, 400);
        const matchScore = Math.max(0, Math.min(100, Number(item.matchScore)));
        seen.add(title.toLowerCase());
        return { title, reason, matchScore };
      })
      .slice(0, 3);

    const summary =
      answer?.summary?.trim().slice(0, 500) ||
      'Here are recommendations based on your query and retrieved movies.';

    return { recommendations, summary };
  }

  // Normalize user query into a predictable format:
  // - strips control chars to reduce parser/prompt weirdness
  // - collapses repeated whitespace
  // - trims edges so validation and matching stay consistent
  private normalizeRagQuery(query: string): string {
    return (query ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isRagQueryLengthAllowed(query: string): boolean {
    return (
      query.length >= this.RAG_QUERY_MIN_LEN &&
      query.length <= this.RAG_QUERY_MAX_LEN
    );
  }

  private isUnsafeRagQuery(query: string): boolean {
    return this.BLOCKED_QUERY_PATTERNS.some((pattern) => pattern.test(query));
  }

  // Sanitizes DB text before injecting it into LLM context:
  // - guarantees string output for unknown/null values
  // - removes control chars and extra spaces
  // - caps length so one field cannot dominate the prompt
  private safeField(value: unknown, maxLen: number): string {
    return String(value ?? 'unknown')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen);
  }

  private getSearchCacheKey(query: string): string {
    const hash = createHash('sha256').update(query).digest('hex');
    return `search:v1:${hash}`;
  }

  private getRagCacheKey(query: string): string {
    const hash = createHash('sha256').update(query).digest('hex');
    return `rag:v1:${hash}`;
  }
}