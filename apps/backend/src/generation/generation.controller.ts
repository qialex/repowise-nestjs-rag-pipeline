import { Controller, Post, Get, Body, Res, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { Response } from 'express';
import { GenerationService } from './generation.service';
import { ChatHistoryService } from './chat-history.service';
import { AskDto } from './dto/ask.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@ApiTags('Generation')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('ask')
export class GenerationController {
  constructor(
    private readonly generationService: GenerationService,
    private readonly chatHistoryService: ChatHistoryService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Ask a question about an ingested repository',
    description: 'Returns a complete answer (non-streaming).',
  })
  async ask(@Body() dto: AskDto) {
    const answer = await this.generationService.ask(dto.question, dto.repoId);
    return { question: dto.question, answer };
  }

  @Post('stream')
  @ApiOperation({
    summary: 'Ask a question with streaming response (SSE)',
    description: 'Streams the answer token-by-token via Server-Sent Events.',
  })
  async askStream(@Body() dto: AskDto, @Res() res: Response) {
    await this.generationService.askStream(dto.question, dto.repoId, res);
  }

  @Get('history/:repoId')
  @ApiOperation({ summary: 'Get chat history for a repository' })
  async getHistory(@Param('repoId') repoId: string) {
    return this.chatHistoryService.getHistory(repoId);
  }
}
