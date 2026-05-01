import { Module } from '@nestjs/common';
import { MovieService } from './movie.service';
import { MovieController } from './movie.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { RedisCacheService } from '../cache/redis-cache.service';

@Module({
  controllers: [MovieController],
  providers: [MovieService, PrismaService, AiService, RedisCacheService],
})
export class MovieModule {}