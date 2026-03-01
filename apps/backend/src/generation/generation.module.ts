import { Module } from '@nestjs/common';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [RetrievalModule, ChatModule],
  controllers: [GenerationController],
  providers: [GenerationService],
})
export class GenerationModule {}
