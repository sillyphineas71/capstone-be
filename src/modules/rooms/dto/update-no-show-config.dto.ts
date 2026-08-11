import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * NSL-001 (#35) — body PUT no-show-config. 5 field số whitelist + 1 flag bool.
 * forbidNonWhitelisted ở ValidationPipe → key tùy ý bị 400 (SEC).
 *
 * [FIX 2026-08-09, Phần 2] `presenceConfirmSeconds`/`presenceNoiseToleranceSeconds` —
 * ĐƠN VỊ GIÂY, KHÁC 3 field trên (đơn vị PHÚT). Đọc kỹ description từng field trước khi
 * đổi giá trị — nhầm đơn vị ở đây làm sai luôn cơ chế streak-confirm hiện diện.
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

  @ApiPropertyOptional({
    description:
      'Số GIÂY (không phải phút) có mặt liên tục tối thiểu để xác nhận đã tham dự thật (chống việc vào 1 giây rồi ra để né no-show).',
    minimum: 1,
    maximum: 3600,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3600)
  presenceConfirmSeconds?: number;

  @ApiPropertyOptional({
    description:
      'Số GIÂY (không phải phút) gián đoạn (count=0) tối đa được coi là nhiễu cảm biến, không làm gãy chuỗi hiện diện liên tục.',
    minimum: 0,
    maximum: 300,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(300)
  presenceNoiseToleranceSeconds?: number;

  @ApiPropertyOptional({
    description: 'Bật/tắt tự động giải phóng phòng khi no-show',
  })
  @IsOptional()
  @IsBoolean()
  autoReleaseEnabled?: boolean;
}
