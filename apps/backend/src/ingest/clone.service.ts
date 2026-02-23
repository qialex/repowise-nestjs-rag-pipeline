import { Injectable, Logger } from '@nestjs/common';
import * as simpleGit from 'simple-git';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

@Injectable()
export class CloneService {
  private readonly logger = new Logger(CloneService.name);

  async clone(repoUrl: string, branch?: string): Promise<string> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repowise-'));

    const git = simpleGit.default();
    const cloneOptions: string[] = ['--depth', '1'];

    if (branch) {
      cloneOptions.push('--branch', branch);
    }

    this.logger.log(`Cloning ${repoUrl} into ${tmpDir}`);
    await git.clone(repoUrl, tmpDir, cloneOptions);

    return tmpDir;
  }

  async cleanup(repoPath: string): Promise<void> {
    try {
      await fs.rm(repoPath, { recursive: true, force: true });
      this.logger.log(`Cleaned up ${repoPath}`);
    } catch (error) {
      this.logger.warn(`Failed to cleanup ${repoPath}: ${error.message}`);
    }
  }
}
