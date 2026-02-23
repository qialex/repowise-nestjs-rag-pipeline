import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { EnvValidationService } from '../common/env-validation.service';

@Module({
  controllers: [HealthController],
  providers: [EnvValidationService],
})
export class HealthModule {}
