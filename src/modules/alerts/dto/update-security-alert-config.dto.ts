import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ASC-001 auto-resolve timeout — body PUT security-alerts-config. Chỉ 1 field
 * whitelist. forbidNonWhitelisted ở ValidationPipe → key tùy ý bị 400.
 */
export class UpdateSecurityAlertConfigDto {
  @ApiPropertyOptional({
    description: 'Thời gian (phút) trước khi tự động resolve cảnh báo không tái phát',
    minimum: 1,
    maximum: 1440,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  autoResolveTimeoutMinutes?: number;
}
