import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EnvStatus {
  name: string;
  configured: boolean;
  reason?: string;
}

@Injectable()
export class EnvValidationService implements OnModuleInit {
  private readonly logger = new Logger(EnvValidationService.name);
  private readonly issues: EnvStatus[] = [];

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.validate();
  }

  private validate() {
    this.checkVar('OPENAI_API_KEY', 'Required for embeddings and LLM generation', (v) =>
      v.startsWith('sk-') ? undefined : 'Must start with "sk-"',
    );
    this.checkVar('UPSTASH_VECTOR_URL', 'Required for vector store');
    this.checkVar('UPSTASH_VECTOR_TOKEN', 'Required for vector store');
    this.checkVar('REDIS_HOST', 'Required for BullMQ job queue');
    this.checkVar('REDIS_PASSWORD', 'Required for Redis authentication');

    const problems = this.issues.filter((i) => !i.configured);
    if (problems.length > 0) {
      this.logger.warn('=== MISSING OR INVALID ENVIRONMENT VARIABLES ===');
      for (const p of problems) {
        this.logger.warn(`  ❌ ${p.name}: ${p.reason}`);
      }
      this.logger.warn(
        'The app is running but some features will be unavailable until these are configured.',
      );
      this.logger.warn('=================================================');
    } else {
      this.logger.log('✅ All required environment variables are configured.');
    }
  }

  private checkVar(name: string, description: string, validator?: (v: string) => string | undefined) {
    const value = this.config.get<string>(name);
    const placeholder = this.isPlaceholder(value);

    if (!value || placeholder) {
      this.issues.push({
        name,
        configured: false,
        reason: !value ? `Not set. ${description}` : `Contains placeholder value. ${description}`,
      });
      return;
    }

    if (validator) {
      const error = validator(value);
      if (error) {
        this.issues.push({ name, configured: false, reason: `${error}. ${description}` });
        return;
      }
    }

    this.issues.push({ name, configured: true });
  }

  private isPlaceholder(value: string | undefined): boolean {
    if (!value) return true;
    const placeholders = ['your-', 'sk-...', 'changeme', 'xxx', 'TODO', 'REPLACE'];
    return placeholders.some((p) => value.toLowerCase().includes(p.toLowerCase()));
  }

  isConfigured(name: string): boolean {
    const status = this.issues.find((i) => i.name === name);
    return status?.configured ?? false;
  }

  getStatus(): EnvStatus[] {
    return [...this.issues];
  }

  getMissingVars(): EnvStatus[] {
    return this.issues.filter((i) => !i.configured);
  }
}

