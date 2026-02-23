import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { EnvValidationService } from '../common/env-validation.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly envValidation: EnvValidationService) {}

  @Get()
  @ApiOperation({ summary: 'Health check — used to keep the service alive' })
  check() {
    const missingVars = this.envValidation.getMissingVars();
    return {
      status: missingVars.length > 0 ? 'degraded' : 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      ...(missingVars.length > 0 && {
        warnings: missingVars.map((v) => ({
          variable: v.name,
          reason: v.reason,
        })),
      }),
    };
  }
}
