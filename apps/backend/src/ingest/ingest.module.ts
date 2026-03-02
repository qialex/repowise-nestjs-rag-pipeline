import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { CloneService } from './clone.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { CancellationService } from './cancellation.service';
import { IngestProcessor } from './ingest.processor';
import { ChatModule } from '../chat/chat.module';
import { INGEST_QUEUE } from './constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: INGEST_QUEUE }),
    ChatModule,
  ],
  controllers: [IngestController],
  providers: [
    IngestService,
    CloneService,
    ChunkingService,
    EmbeddingService,
    VectorStoreService,
    CancellationService,
    IngestProcessor,
  ],
  exports: [VectorStoreService, EmbeddingService],
})
export class IngestModule {}
