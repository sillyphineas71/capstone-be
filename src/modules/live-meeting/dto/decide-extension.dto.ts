import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Request DTO cho UC-IMM-03 Phê duyệt/từ chối yêu cầu gia hạn phiên họp.
 */
export class DecideExtensionDto {
  @IsIn(['approved', 'rejected'], {
    message: 'decision must be either "approved" or "rejected"',
  })
  decision: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
