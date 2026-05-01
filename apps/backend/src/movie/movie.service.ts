import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { CreateMovieDto } from './movie.interface';

@Injectable()
export class MovieService {
  constructor(
    private prisma: PrismaService,
    private ai: AiService,
  ) {}

  async create(body: CreateMovieDto) {
    const { title, description, genre, year, rating, themes, mood } = body;

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
    // 1. keyword search
    const keywordResults = await this.prisma.$queryRaw<any[]>`
      SELECT 
        id,
        ts_rank(search_vector, plainto_tsquery('english', ${query})) AS bm25_score
      FROM movies
      WHERE search_vector @@ plainto_tsquery('english', ${query})
      ORDER BY bm25_score DESC
      LIMIT 4;
    `;

    const bm25Map = new Map(
      keywordResults.map(r => [r.id, r.bm25_score])
    );
    const maxBm25 = Math.max(...bm25Map.values(), 1);

    // 2. convert query → embedding
    const queryEmbedding = await this.ai.createEmbedding(query);

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
        query,
        movie.themes ?? [],
      );

      // genre boost (simple keyword match, safe)
      const genreBoost =
        movie.genre?.some((g: string) =>
          query.toLowerCase().includes(g.toLowerCase())
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
    return ranked
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  async ragSearch(query: string) {
    // 1. retrieve
    const movies = await this.search(query);

    // 2. build context
    const context = movies.slice(0, 5).map((m, i) => `
  ${i + 1}. ${m.title}
  Genres: ${m.genre?.join(", ")}
  Themes: ${m.themes?.join(", ")}
  Mood: ${m.mood}
  Description: ${m.description}
  `).join("\n");

    // 3. AI call via AiService (NOT direct)
    const answer = await this.ai.chatCompletionV2([
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
  User query: ${query}

  Movies:
  ${context}
        `,
      },
    ]);

    return {
      query,
      answer,
      results: movies,
    };
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
}