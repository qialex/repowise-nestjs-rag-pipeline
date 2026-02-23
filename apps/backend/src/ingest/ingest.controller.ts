import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { IngestService } from './ingest.service';
import { IngestRepoDto } from './dto/ingest-repo.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@ApiTags('Ingest')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('ingest')
export class IngestController {
  constructor(private readonly ingestService: IngestService) {}

  @Post('repo')
  @ApiOperation({
    summary: 'Ingest a GitHub repository',
    description:
      'Clones the repo, chunks all code files, embeds them, and stores in the vector DB. Processing happens asynchronously via BullMQ queue.',
  })
  @ApiResponse({ status: 202, description: 'Ingestion job queued' })
  @HttpCode(HttpStatus.ACCEPTED)
  async ingestRepo(@Body() dto: IngestRepoDto) {
    const job = await this.ingestService.queueIngest(dto);
    return {
      message: 'Repository ingestion queued',
      jobId: job.id,
      repoUrl: dto.repoUrl,
    };
  }

  @Get('status/:jobId')
  @ApiOperation({ summary: 'Check ingestion job status' })

  async getStatus(@Param('jobId') jobId: string) {
    return this.ingestService.getJobStatus(jobId);
  }

  @Get('repos')
  @ApiOperation({ summary: 'List all ingested repositories' })
  async listRepos() {
    return this.ingestService.listIngested();
  }

  @Delete('repo/:repoId')
  @ApiOperation({ summary: 'Remove a repository from the vector store' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRepo(@Param('repoId') repoId: string) {
    await this.ingestService.deleteRepo(repoId);
  }
}
