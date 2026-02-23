import { Module } from '@nestjs/common';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { RetrievalModule } from '../retrieval/retrieval.module';

@Module({
  imports: [RetrievalModule],
  controllers: [GenerationController],
  providers: [GenerationService],
})
export class GenerationModule {}
