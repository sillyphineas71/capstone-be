import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * AuditLogItemDto — 1 bản ghi audit log trả về cho client.
 *
 * Chỉ trả đúng 5 trường hiển thị theo spec:
 *   Timestamp (createdAt), Actor (actorUserId + actorName),
 *   Action (actionType), Entity (entityType + entityId), Severity.
 *
 * KHÔNG bao gồm: oldValueJson, newValueJson, metadataJson,
 * ipAddress, userAgent, requestId (FR-025).
 */
export class AuditLogItemDto {
  @ApiProperty({ description: 'UUID của bản ghi audit log' })
  id: string;

  @ApiProperty({ description: 'Thời điểm ghi log (UTC)' })
  createdAt: Date;

  @ApiPropertyOptional({
    description: 'UUID của người thực hiện; null nếu hệ thống tự động',
    nullable: true,
  })
  actorUserId: string | null;

  @ApiProperty({
    description: 'Tên hiển thị của người thực hiện; "Hệ thống" nếu null',
  })
  actorName: string;

  @ApiProperty({ description: 'Loại hành động (e.g. "meeting.create")' })
  actionType: string;

  @ApiProperty({ description: 'Loại entity bị tác động (e.g. "meeting")' })
  entityType: string;

  @ApiPropertyOptional({
    description: 'UUID của entity bị tác động; null nếu không áp dụng',
    nullable: true,
  })
  entityId: string | null;

  @ApiProperty({
    description: 'Mức độ nghiêm trọng',
    enum: ['info', 'warning', 'error', 'critical'],
  })
  severity: string;
}

/**
 * AuditLogListResponseDto — wrapper phân trang cho danh sách audit logs.
 */
export class AuditLogListResponseDto {
  @ApiProperty({ type: [AuditLogItemDto] })
  data: AuditLogItemDto[];

  @ApiProperty({
    description: 'Metadata phân trang',
    example: { page: 1, limit: 20, total: 100, totalPages: 5 },
  })
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
