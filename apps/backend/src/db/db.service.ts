import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

@Injectable()
export class DbService {
  readonly db: ReturnType<typeof drizzle<typeof schema>>;

  constructor(config: ConfigService) {
    const sql = neon(config.getOrThrow<string>('DATABASE_URL'));
    this.db = drizzle(sql, { schema });
  }
}
