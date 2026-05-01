import { Injectable } from '@nestjs/common';
import { InferenceClient } from '@huggingface/inference';
import { MovieRecommendationSchema } from 'src/movie/movie.interface';
import { createHash } from 'crypto';
import { RedisCacheService } from '../cache/redis-cache.service';

@Injectable()
export class AiService {
  private client: InferenceClient;
  private readonly EMBEDDING_CACHE_TTL_SECONDS = 60 * 60 * 24;

  constructor(private readonly cache: RedisCacheService) {
    console.log('[AiService] Initializing Hugging Face client');
    this.client = new InferenceClient(process.env.HUGGING_FACE_API_TOKEN);
  }

  async createEmbedding(text: string): Promise<number[]> {
    console.log('[AiService] createEmbedding input length:', text?.length ?? 0);
    const normalizedInput = this.normalizeText(text);
    const cacheKey = this.getEmbeddingCacheKey(normalizedInput);
    const cached = await this.cache.getJson<number[]>(cacheKey);
    if (cached) {
      console.log('[AiService] createEmbedding cache hit');
      return cached;
    }

    const res = await this.client.featureExtraction({
      model: 'sentence-transformers/all-MiniLM-L6-v2',
      inputs: normalizedInput,
    });

    await this.cache.setJson(cacheKey, res, this.EMBEDDING_CACHE_TTL_SECONDS);
    console.log('[AiService] createEmbedding success');
    return res as number[];
  }

  async chatCompletion(messages: any[], options?: any): Promise<string> {
    const res = await this.client.chatCompletion({
      model: 'meta-llama/Llama-3.1-8B-Instruct',
      messages,
      // Do NOT use a 'parameters' object here
      max_tokens: options?.max_new_tokens ?? 200, 
      temperature: options?.temperature ?? 0.3,
      top_p: 0.9, // Optional: helpful for better quality
    });

    return res.choices?.[0]?.message?.content?.trim() ?? '';
  }

  async chatCompletionV2(messages: any[]) {
    console.log('[AiService] chatCompletionV2 request messages:', messages?.length ?? 0);

    // Using standard fetch or an OpenAI library pointing to your docker service
    const response = await fetch('http://localhost:11434/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.1', // The model you downloaded
        messages: messages,
        stream: false,
      }),
    });

    const data = await response.json();
    console.log('[AiService] chatCompletionV2 raw response received');

    if (data.error || !data.choices) {
      throw new Error(data.error || "Failed to get choices from Ollama");
    }

    try {
      const rawContent = data.choices[0].message.content;
      const rawJson = this.extractJsonFromText(rawContent);
      console.log('[AiService] chatCompletionV2 JSON parse success');
      return MovieRecommendationSchema.parse(rawJson);
    } catch (e) {
      console.log('[AiService] chatCompletionV2 JSON parse fallback');
      return { recommendations: [], summary: "Sorry, I had trouble formatting the response." };
    }    
  }

  // Attempts strict parsing first, then a fenced-block JSON fallback.
  private extractJsonFromText(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      const fencedJson = text.match(/```json\s*([\s\S]*?)\s*```/i);
      if (fencedJson?.[1]) {
        return JSON.parse(fencedJson[1]);
      }

      const objectLike = text.match(/\{[\s\S]*\}/);
      if (objectLike?.[0]) {
        return JSON.parse(objectLike[0]);
      }

      throw new Error('AI response did not contain valid JSON');
    }
  }

  private normalizeText(text: string): string {
    return String(text ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getEmbeddingCacheKey(text: string): string {
    const hash = createHash('sha256').update(text).digest('hex');
    return `emb:v1:${hash}`;
  }
}