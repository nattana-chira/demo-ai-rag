import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MovieModule } from './movie/movie.module';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    MovieModule,
    ConfigModule.forRoot({ isGlobal: true }),
    // Global baseline rate limit:
    // ttl=60000 -> 60s window, limit=30 -> max 30 requests per 60s (per client).
    // Endpoints can override with stricter limits (e.g. /movies/rag).
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 30,
      },
    ]),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
