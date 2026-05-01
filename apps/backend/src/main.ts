import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { randomUUID } from 'crypto';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  app.use((req: any, res: any, next: () => void) => {
    const requestId = req.headers['x-request-id'] || randomUUID();
    const start = Date.now();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    console.log(`[RequestStart] id=${requestId} method=${req.method} path=${req.originalUrl}`);

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      console.log(
        `[RequestEnd] id=${requestId} status=${res.statusCode} durationMs=${durationMs}`,
      );
    });

    next();
  });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
