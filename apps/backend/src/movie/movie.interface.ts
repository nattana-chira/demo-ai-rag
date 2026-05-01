import { z } from 'zod';

export class CreateMovieDto {
  title: string;
  description: string;
  genre: string[];
  themes?: string[];
  mood?: string;
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

export const CreateMovieSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(10).max(4000),
  genre: z.array(z.string().trim().min(1)).min(1).max(5),
  themes: z.array(z.string().trim().min(1)).max(15).optional(),
  mood: z.string().trim().min(1).max(100).optional(),
  year: z.number().int().min(1888).max(2100).optional(),
  rating: z.number().min(0).max(10).optional(),
});

export type CreateMovieInput = z.infer<typeof CreateMovieSchema>;

export const MovieRecommendationSchema = z.object({
  recommendations: z.array(z.object({
    title: z.string(),
    reason: z.string(),
    matchScore: z.number().min(0).max(100),
  })),
  summary: z.string()
});

export type MovieRecommendation = z.infer<typeof MovieRecommendationSchema>;