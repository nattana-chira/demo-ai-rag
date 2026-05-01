import { Injectable } from '@nestjs/common';
import { InferenceClient } from '@huggingface/inference';
import { MovieRecommendationSchema } from 'src/movie/movie.interface';

@Injectable()
export class AiService {
  private client: InferenceClient;

  constructor() {
    console.log("HF KEY:", process.env.HUGGING_FACE_API_TOKEN);

    this.client = new InferenceClient(process.env.HUGGING_FACE_API_TOKEN);
  }

  async createEmbedding(text: string): Promise<number[]> {
    const res = await this.client.featureExtraction({
      model: 'sentence-transformers/all-MiniLM-L6-v2',
      inputs: text,
    });

    console.log("HF RESULT:", res);

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

  async chatCompletionV2(messages: any[]): Promise<any> {
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
    console.error("Ollama Response:", data?.choices?.[0]?.message?.content);

    if (data.error || !data.choices) {
      throw new Error(data.error || "Failed to get choices from Ollama");
    }

    try {
      // 1. Parse the string output from the Transformer
      const rawJson = JSON.parse(data.choices[0].message.content);

      // 2. Validate with Zod (The Guardrail)
      return MovieRecommendationSchema.parse(rawJson);
    } catch (e) {
      // 3. Fallback if the Transformer fails to follow instructions
      console.error("AI returned invalid JSON", response);
      return { recommendations: [], summary: "Sorry, I had trouble formatting the response." };
    }    
  }
}