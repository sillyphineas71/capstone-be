import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ManualAttendanceResponseDto } from './manual-attendance-response.dto.js';

/**
 * UC-82 — Một mục lịch sử chỉnh sửa (đọc lại từ audit_logs của bản ghi điểm danh).
 */
export class AttendanceEditHistoryItemDto {
  @ApiProperty({ format: 'date-time', description: 'Thời điểm thao tác (ISO)' })
  at: string;

  @ApiPropertyOptional({
    nullable: true,
    format: 'uuid',
    description: 'User thực hiện',
  })
  actorUserId: string | null;

  @ApiProperty({
    description:
      'create_manual_attendance | update_attendance_status | update_attendance_record | invalidate_attendance',
  })
  actionType: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Nội dung thay đổi: {old,new} nếu audit có old/new; hoặc metadata (vd {reason}) nếu chỉ có metadata; null nếu không có.',
  })
  changes: Record<string, unknown> | null;
}

/**
 * UC-82 — Chi tiết một bản ghi điểm danh (read-only).
 * Kế thừa ManualAttendanceResponseDto (17 field nghiệp vụ) + tên người/họp + editHistory.
 */
export class AttendanceRecordDetailResponseDto extends ManualAttendanceResponseDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Tên người được điểm danh',
  })
  userFullName: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Tên (title) cuộc họp' })
  meetingTitle: string | null;

  @ApiProperty({
    type: [AttendanceEditHistoryItemDto],
    description: 'Lịch sử chỉnh sửa (sort theo at tăng dần)',
  })
  editHistory: AttendanceEditHistoryItemDto[];
}
