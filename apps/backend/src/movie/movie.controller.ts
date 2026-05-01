import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { MovieService } from './movie.service';
import { CreateMovieDto } from './movie.interface';

@Controller('movies')
export class MovieController {
  constructor(private movieService: MovieService) {}

  @Post()
  async create(@Body() body: CreateMovieDto) {
    return this.movieService.create(body);
  }

  @Get('search')
  async search(@Query('q') q: string) {
    const movies = await this.movieService.search(q);

    return {
      result: movies.length,
      data: movies.map(({ embedding, ...m }) => m),
    }
  }

  @Get('rag')
  async rag(@Query('q') q: string) {
    return this.movieService.ragSearch(q);
  }
}