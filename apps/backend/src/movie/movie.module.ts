import { Module } from '@nestjs/common';
import { MovieService } from './movie.service';
import { MovieController } from './movie.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

@Module({
  controllers: [MovieController],
  providers: [MovieService, PrismaService, AiService],
})
export class MovieModule {}