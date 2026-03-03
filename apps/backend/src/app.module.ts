import * as path from 'path';
import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { DbModule } from './db/db.module';
import { IngestModule } from './ingest/ingest.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { GenerationModule } from './generation/generation.module';
import { HealthModule } from './health/health.module';
import { EnvValidationService } from './common/env-validation.service';

const logger = new Logger('AppModule');

function isRedisConfigured(config: ConfigService): boolean {
  const host = config.get<string>('REDIS_HOST');
  if (!host) return false;
  const placeholders = ['your-', 'changeme', 'xxx', 'TODO', 'REPLACE'];
  return !placeholders.some((p) => host.toLowerCase().includes(p.toLowerCase()));
}

@Module({
  imports: [
    // Config — loads .env
    ConfigModule.forRoot({
      isGlobal: true,
      // Explicit path so it works regardless of process CWD (e.g. monorepo root in Docker dev)
      envFilePath: path.join(__dirname, '..', '.env'),
    }),

    // Rate limiting
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }]),

    // BullMQ — backed by Redis (tolerates missing config)
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        if (!isRedisConfigured(config)) {
          logger.warn(
            'REDIS_HOST is not configured. BullMQ job queue will be unavailable. ' +
            'Ingest jobs will fail until Redis is configured.',
          );
          // Return a connection to a non-existent host with lazy connect
          // so the module loads but connections fail gracefully at request time
          return {
            connection: {
              host: '127.0.0.1',
              port: 6379,
              lazyConnect: true,
              maxRetriesPerRequest: 0,
              retryStrategy: () => null,
            },
          };
        }
        return {
          connection: {
            host: config.get('REDIS_HOST'),
            port: config.get<number>('REDIS_PORT', 6379),
            password: config.get('REDIS_PASSWORD'),
            tls: config.get('REDIS_TLS') === 'true' ? {} : undefined,
            // Required for BullMQ workers — prevents ioredis from timing out
            // on blocking commands (BRPOPLPUSH / BLMOVE) used by the queue
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          },
        };
      },
    }),

    // Cron jobs
    ScheduleModule.forRoot(),

    // Database
    DbModule,

    // Feature modules
    IngestModule,
    RetrievalModule,
    GenerationModule,
    HealthModule,
  ],
  providers: [EnvValidationService],
})
export class AppModule {}
