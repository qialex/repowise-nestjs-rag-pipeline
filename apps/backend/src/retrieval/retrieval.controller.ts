import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiSecurity } from '@nestjs/swagger';
import { RetrievalService } from './retrieval.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@ApiTags('Retrieval')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('retrieval')
export class RetrievalController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Semantic search over ingested repos',
    description: 'Returns the top K most relevant code chunks for a given query.',
  })
  @ApiQuery({ name: 'q', description: 'Search query' })
  @ApiQuery({ name: 'repoId', required: false, description: 'Filter by repository ID' })
  @ApiQuery({ name: 'topK', required: false, type: Number, description: 'Number of results (default: 5)' })
  async search(
    @Query('q') query: string,
    @Query('repoId') repoId?: string,
    @Query('topK') topK = 5,
  ) {
    const results = await this.retrievalService.retrieve(query, repoId, topK);
    return { query, results };
  }
}
