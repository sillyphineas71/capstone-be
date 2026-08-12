import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayMinSize, ArrayMaxSize, IsUUID } from 'class-validator';

/**
 * BulkAcknowledgeSecurityAlertsDto (ASC-001 / UC-123 AF1) — body POST
 * /api/v1/security-alerts/bulk-acknowledge. Giới hạn 50 id/request (hành động GHI,
 * thấp hơn max limit=100 của pagination — spec §2.7).
 */
export class BulkAcknowledgeSecurityAlertsDto {
  @ApiProperty({
    description:
      'Danh sách ID cảnh báo cần xác nhận hàng loạt (tối đa 50 id/request)',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  ids: string[];
}
