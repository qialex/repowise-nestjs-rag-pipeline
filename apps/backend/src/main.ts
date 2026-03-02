import * as path from 'path';
import * as dotenv from 'dotenv';
// Load .env before any module initialises — override: true ensures .env wins
// over any stale shell/Docker env vars (e.g. REDIS_HOST=redis from a previous run)
dotenv.config({ path: path.join(__dirname, '..', '.env'), override: true });

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global validation
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // CORS for Next.js frontend
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST', 'DELETE'],
  });

  // Swagger API docs
  const config = new DocumentBuilder()
    .setTitle('Repowise API')
    .setDescription('RAG pipeline over GitHub repositories — built with NestJS')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT || 3001);
  console.log(`🚀 Repowise API running on port ${process.env.PORT || 3001}`);
  console.log(`📚 Swagger docs at http://localhost:${process.env.PORT || 3001}/docs`);
}

bootstrap();
