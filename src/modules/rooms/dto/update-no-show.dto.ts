import { IsOptional, IsString, IsIn, MaxLength } from 'class-validator';

/**
 * Body cập nhật no-show case (UC-42).
 * detectionStatus KHÔNG IsIn hẹp ở DTO — để service phân biệt
 * INVALID_NO_SHOW_TRANSITION (warning_sent/released) vs INVALID_DETECTION_STATUS.
 */
export class UpdateNoShowDto {
  @IsOptional()
  @IsString()
  detectionStatus?: string;

  @IsOptional()
  @IsIn(['kept', 'false_positive', 'manual_override'])
  resolutionStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
