import { Controller, Post, Body, Get, Query, UseGuards } from '@nestjs/common';
import { MovieService } from './movie.service';
import { CreateMovieDto } from './movie.interface';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

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
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async rag(@Query('q') q: string) {
    return this.movieService.ragSearch(q);
  }
}