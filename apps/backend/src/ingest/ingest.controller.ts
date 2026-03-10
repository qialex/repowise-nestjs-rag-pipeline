import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
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

  @Get('logs/:jobId')
  @ApiOperation({ summary: 'Stream ingestion logs via SSE' })
  async streamLogs(@Param('jobId') jobId: string, @Res() res: Response) {
    return this.ingestService.streamLogs(jobId, res);
  }

  @Post('restart/:jobId')
  @ApiOperation({ summary: 'Restart an ingestion job regardless of its current state' })
  @ApiResponse({ status: 202, description: 'Ingestion job restarted' })
  @HttpCode(HttpStatus.ACCEPTED)
  async restartJob(@Param('jobId') jobId: string) {
    const job = await this.ingestService.restartJob(jobId);
    return { message: 'Repository ingestion restarted', jobId: job.id };
  }

  @Get('repos')
  @ApiOperation({ summary: 'List all ingested repositories' })
  async listRepos() {
    return this.ingestService.listIngested();
  }

  @Get('repos/stream')
  @ApiOperation({ summary: 'Stream repo list updates via SSE' })
  async streamRepos(@Res() res: Response) {
    return this.ingestService.streamRepos(res);
  }

  @Delete('repo/:repoId')
  @ApiOperation({ summary: 'Remove a repository from the vector store' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRepo(@Param('repoId') repoId: string) {
    await this.ingestService.deleteRepo(repoId);
  }
}
