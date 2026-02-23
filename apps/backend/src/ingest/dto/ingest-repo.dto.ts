import { IsUrl, IsOptional, IsString, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IngestRepoDto {
  @ApiProperty({
    example: 'https://github.com/nestjs/nest',
    description: 'Public GitHub repository URL',
  })
  @IsUrl()
  repoUrl: string;

  @ApiPropertyOptional({
    example: ['src/**/*.ts', 'README.md'],
    description: 'Glob patterns for files to include. Defaults to common code file types.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  includePatterns?: string[];

  @ApiPropertyOptional({
    example: 'main',
    description: 'Branch to clone. Defaults to the default branch.',
  })
  @IsOptional()
  @IsString()
  branch?: string;
}
