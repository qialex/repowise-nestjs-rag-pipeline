import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
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
    ConfigModule.forRoot({ isGlobal: true }),

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
          },
        };
      },
    }),

    // Cron jobs
    ScheduleModule.forRoot(),

    // Feature modules
    IngestModule,
    RetrievalModule,
    GenerationModule,
    HealthModule,
  ],
  providers: [EnvValidationService],
})
export class AppModule {}
