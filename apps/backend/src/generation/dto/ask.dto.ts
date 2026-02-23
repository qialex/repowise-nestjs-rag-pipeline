import { IsString, IsOptional, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AskDto {
  @ApiProperty({
    example: 'How is authentication handled in this codebase?',
    description: 'The question to ask about the repository',
  })
  @IsString()
  @MinLength(3)
  question: string;

  @ApiPropertyOptional({
    example: 'nestjs-nest',
    description: 'Repository ID to scope the question. If omitted, searches all ingested repos.',
  })
  @IsOptional()
  @IsString()
  repoId?: string;
}
