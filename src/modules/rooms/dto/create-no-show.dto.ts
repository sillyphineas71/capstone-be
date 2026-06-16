import { IsUUID, IsOptional, IsIn, IsObject } from 'class-validator';

/** Body tạo no-show case (UC-41 internal). detectionStatus chỉ {risk, confirmed} (NC-6). */
export class CreateNoShowDto {
  @IsUUID('4')
  bookingId: string;

  @IsUUID('4')
  meetingId: string;

  @IsUUID('4')
  roomId: string;

  @IsOptional()
  @IsIn(['risk', 'confirmed'])
  detectionStatus?: 'risk' | 'confirmed';

  @IsOptional()
  @IsObject()
  evidenceJson?: Record<string, unknown>;
}
