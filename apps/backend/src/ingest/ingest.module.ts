import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { IngestProcessor } from './ingest.processor';
import { IngestLogService } from './ingest-log.service';
import { INGEST_QUEUE } from './constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: INGEST_QUEUE }),
  ],
  controllers: [IngestController],
  providers: [
    IngestService,
    EmbeddingService,
    VectorStoreService,
    IngestProcessor,
    IngestLogService,
  ],
  exports: [VectorStoreService, EmbeddingService],
})
export class IngestModule {}
