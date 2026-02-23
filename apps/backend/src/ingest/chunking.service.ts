import { Injectable, Logger } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import * as glob from 'glob';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface CodeChunk {
  content: string;
  metadata: {
    filePath: string;
    fileExtension: string;
    chunkIndex: number;
    totalChunks?: number;
  };
}

interface ChunkOptions {
  includePatterns: string[];
  excludePatterns: string[];
  chunkSize: number;
  chunkOverlap: number;
}

@Injectable()
export class ChunkingService {
  private readonly logger = new Logger(ChunkingService.name);

  async chunkRepo(repoPath: string, options: ChunkOptions): Promise<CodeChunk[]> {
    const files = await this.getFiles(repoPath, options);
    this.logger.log(`Found ${files.length} files to chunk`);

    const allChunks: CodeChunk[] = [];

    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const relativePath = path.relative(repoPath, filePath);
        const ext = path.extname(filePath);

        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: options.chunkSize,
          chunkOverlap: options.chunkOverlap,
          separators: ['\n\n', '\n', ' ', ''],
        });

        const chunks = await splitter.splitText(content);

        chunks.forEach((chunk, index) => {
          allChunks.push({
            content: chunk,
            metadata: {
              filePath: relativePath,
              fileExtension: ext,
              chunkIndex: index,
              totalChunks: chunks.length,
            },
          });
        });
      } catch (error) {
        this.logger.warn(`Skipping ${filePath}: ${error.message}`);
      }
    }

    return allChunks;
  }

  private async getFiles(repoPath: string, options: ChunkOptions): Promise<string[]> {
    const files: string[] = [];

    for (const pattern of options.includePatterns) {
      const matched = glob.sync(pattern, {
        cwd: repoPath,
        absolute: true,
        ignore: options.excludePatterns,
        nodir: true,
      });
      files.push(...matched);
    }

    // Deduplicate
    return [...new Set(files)];
  }
}
