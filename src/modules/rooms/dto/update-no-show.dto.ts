import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, MaxLength } from 'class-validator';

/**
 * Body cập nhật no-show case (UC-42).
 * detectionStatus KHÔNG IsIn hẹp ở DTO — để service phân biệt
 * INVALID_NO_SHOW_TRANSITION (warning_sent/released) vs INVALID_DETECTION_STATUS.
 */
export class UpdateNoShowDto {
  @ApiPropertyOptional({
    description:
      'Trạng thái phát hiện mới (service tự validate transition hợp lệ)',
  })
  @IsOptional()
  @IsString()
  detectionStatus?: string;

  @ApiPropertyOptional({
    description: 'Kết luận xử lý case',
    enum: ['kept', 'false_positive', 'manual_override'],
  })
  @IsOptional()
  @IsIn(['kept', 'false_positive', 'manual_override'])
  resolutionStatus?: string;

  @ApiPropertyOptional({ description: 'Ghi chú xử lý', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
