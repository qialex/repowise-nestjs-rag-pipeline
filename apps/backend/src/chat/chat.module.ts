import { Module } from '@nestjs/common';
import { ChatHistoryService } from '../generation/chat-history.service';

@Module({
  providers: [ChatHistoryService],
  exports: [ChatHistoryService],
})
export class ChatModule {}
