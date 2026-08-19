import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * UserAuditLogItemDto — 1 dòng lịch sử hoạt động của một user (đối tượng bị
 * tác động), phục vụ modal "Lịch sử hoạt động" của Business Admin.
 *
 * Format khớp be-user-activity-log-requirement.md (13/08/2026): giàu hơn
 * AuditLogItemDto của GET /audit-logs (vốn khóa 5 trường theo FR-025).
 */
export class UserAuditLogItemDto {
  @ApiProperty({ description: 'UUID bản ghi (key cho React list)' })
  id: string;

  @ApiProperty({ description: 'Thời điểm xảy ra (ISO 8601, UTC)' })
  timestamp: Date;

  @ApiProperty({ description: 'Tên người thực hiện; "Hệ thống" nếu tự động' })
  actorName: string;

  @ApiPropertyOptional({
    description: 'Email người thực hiện; null nếu hệ thống',
    nullable: true,
  })
  actorEmail: string | null;

  @ApiProperty({ description: 'Mã hành động thô của BE (vd "ACCOUNT_LOCK")' })
  action: string;

  @ApiProperty({ description: 'Loại đối tượng bị tác động (luôn "users")' })
  entity: string;

  @ApiProperty({
    description: 'Kết quả hành động',
    enum: ['success', 'failed'],
  })
  status: 'success' | 'failed';

  @ApiProperty({ description: 'Mô tả tiếng Việt ngắn gọn do BE sinh' })
  description: string;

  @ApiPropertyOptional({
    description: 'Địa chỉ IP người thực hiện; null nếu không có',
    nullable: true,
  })
  ipAddress: string | null;

  @ApiPropertyOptional({
    description:
      'Dữ liệu ngữ cảnh (new_value/metadata/old_value); null nếu không có',
    nullable: true,
  })
  payload: Record<string, unknown> | null;
}

/**
 * UserAuditLogListResponseDto — wrapper phân trang.
 */
export class UserAuditLogListResponseDto {
  @ApiProperty({ type: [UserAuditLogItemDto] })
  data: UserAuditLogItemDto[];

  @ApiProperty({
    description: 'Metadata phân trang',
    example: { page: 1, limit: 10, total: 5, totalPages: 1 },
  })
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
