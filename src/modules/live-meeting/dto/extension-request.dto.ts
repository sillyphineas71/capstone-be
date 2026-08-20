import {
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Request DTO cho UC-IMM-02 Yêu cầu gia hạn phiên họp.
 * Host nhap so phut tu do (khong con gioi han theo tap gia tri co dinh);
 * viec auto-accept hay bi tu choi phu thuoc buffer truoc cuoc hop ke tiep,
 * xu ly trong LiveMeetingService.requestExtension.
 */
export class ExtensionRequestDto {
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(240)
  extensionMinutes: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
