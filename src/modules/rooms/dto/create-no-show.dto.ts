import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsOptional, IsIn, IsObject } from 'class-validator';

/** Body tạo no-show case (UC-41 internal). detectionStatus chỉ {risk, confirmed} (NC-6). */
export class CreateNoShowDto {
  @ApiProperty({ description: 'ID lượt đặt phòng bị nghi ngờ no-show' })
  @IsUUID()
  bookingId: string;

  @ApiProperty({ description: 'ID cuộc họp liên quan' })
  @IsUUID()
  meetingId: string;

  @ApiProperty({ description: 'ID phòng họp liên quan' })
  @IsUUID()
  roomId: string;

  @ApiPropertyOptional({
    description: 'Trạng thái phát hiện no-show',
    enum: ['risk', 'confirmed'],
  })
  @IsOptional()
  @IsIn(['risk', 'confirmed'])
  detectionStatus?: 'risk' | 'confirmed';

  @ApiPropertyOptional({
    description: 'Bằng chứng phát hiện đi kèm (JSON tự do)',
  })
  @IsOptional()
  @IsObject()
  evidenceJson?: Record<string, unknown>;
}
