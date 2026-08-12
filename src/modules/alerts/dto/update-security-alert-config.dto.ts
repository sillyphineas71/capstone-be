import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ASC-001 auto-resolve timeout + occurrence debounce — body PUT
 * security-alerts-config. Chỉ 2 field whitelist. forbidNonWhitelisted ở
 * ValidationPipe → key tùy ý bị 400.
 */
export class UpdateSecurityAlertConfigDto {
  @ApiPropertyOptional({
    description:
      'Thời gian (phút) trước khi tự động resolve cảnh báo không tái phát',
    minimum: 1,
    maximum: 1440,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  autoResolveTimeoutMinutes?: number;

  /**
   * [FIX 2026-08-11] Khoảng thời gian (giây) coi 2 lần vi phạm CÙNG userId là "cùng 1
   * lần hiện diện" (KHÔNG tăng occurrence_count/append occurrences) — chống thổi phồng
   * do camera bắn nhiều appear gần-trùng-giờ cho 1 lần đứng yên. min=0 = tắt debounce.
   */
  @ApiPropertyOptional({
    description:
      'Khoảng cách (giây) giữa 2 lần vi phạm CÙNG userId để coi là cùng 1 lần hiện diện, không tính là occurrence mới. 0 = tắt debounce',
    minimum: 0,
    maximum: 300,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(300)
  occurrenceDebounceSeconds?: number;
}
