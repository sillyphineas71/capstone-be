import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * NSL-001 (#35) — body PUT no-show-config. Chỉ 3 field whitelist.
 * forbidNonWhitelisted ở ValidationPipe → key tùy ý bị 400 (SEC).
 */
export class UpdateNoShowConfigDto {
  @ApiPropertyOptional({
    description: 'Số phút chờ trước khi đánh dấu no-show',
    minimum: 1,
    maximum: 1440,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  thresholdMinutes?: number;

  @ApiPropertyOptional({
    description: 'Số phút ân hạn trước khi gửi cảnh báo',
    minimum: 0,
    maximum: 1440,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  warningGraceMinutes?: number;

  @ApiPropertyOptional({
    description: 'Số phút chờ trước khi tự động giải phóng phòng',
    minimum: 1,
    maximum: 1440,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  autoReleaseGraceMinutes?: number;

  @ApiPropertyOptional({ description: 'Bật/tắt tự động giải phóng phòng khi no-show' })
  @IsOptional()
  @IsBoolean()
  autoReleaseEnabled?: boolean;
}
