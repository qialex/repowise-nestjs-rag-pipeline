import { Controller, Post, Body, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { Response } from 'express';
import { GenerationService } from './generation.service';
import { AskDto } from './dto/ask.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@ApiTags('Generation')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('ask')
export class GenerationController {
  constructor(private readonly generationService: GenerationService) {}

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
}
