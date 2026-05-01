import { z } from 'zod';

export class CreateMovieDto {
  title: string;
  description: string;
  genre: string[];
  themes?: string[];
  mood?: string[];
  year?: number;
  rating?: number;
}

export type Genre =
  | 'sci-fi'
  | 'action'
  | 'drama'
  | 'thriller'
  | 'romance'
  | 'comedy'
  | 'horror'
  | 'animation';

export type Mood =
  | 'dark'
  | 'emotional'
  | 'intense'
  | 'light'
  | 'mind-bending'
  | 'uplifting'
  | 'philosophical';

export interface Movie {
  id: string;

  title: string;
  description: string;

  genre: Genre[];

  year?: number;
  rating?: number;

  mood?: Mood;

  embedding: number[]; // vector (1536)

  createdAt: Date;
  updatedAt: Date;
}

export const MovieRecommendationSchema = z.object({
  recommendations: z.array(z.object({
    title: z.string(),
    reason: z.string(),
    matchScore: z.number().min(0).max(100),
  })),
  summary: z.string()
});

export type MovieRecommendation = z.infer<typeof MovieRecommendationSchema>;