import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AttendanceRecordEntity,
  AttendanceRecordStatus,
  AttendanceSource,
  CheckInMethod,
} from '../entities/attendance-record.entity.js';

/**
 * Response shape cho 4 endpoint manual attendance (spec §5).
 * CHỈ lộ đúng tập field nghiệp vụ §5 — KHÔNG kèm field nhạy cảm ngoài schema.
 * Mapper riêng (tasks T-02) — KHÔNG ép tái dùng attendance-item.dto.ts (read-side).
 */
export class ManualAttendanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  meetingId: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  participantId: string | null;

  @ApiProperty({ enum: CheckInMethod })
  checkInMethod: CheckInMethod;

  @ApiProperty({ enum: AttendanceSource })
  attendanceSource: AttendanceSource;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  checkInTime: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  checkOutTime: string | null;

  @ApiProperty()
  isLate: boolean;

  @ApiPropertyOptional({ nullable: true })
  lateMinutes: number | null;

  @ApiProperty()
  leftEarly: boolean;

  @ApiProperty({ enum: AttendanceRecordStatus })
  attendanceStatus: AttendanceRecordStatus;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  verifiedBy: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  verifiedAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  note: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

const toIso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

/**
 * Map entity → response §5. Chỉ chọn đúng field cho phép, KHÔNG spread cả entity.
 */
export function toManualAttendanceResponse(
  entity: AttendanceRecordEntity,
): ManualAttendanceResponseDto {
  return {
    id: entity.id,
    meetingId: entity.meetingId,
    userId: entity.userId,
    participantId: entity.participantId,
    checkInMethod: entity.checkInMethod,
    attendanceSource: entity.attendanceSource,
    checkInTime: toIso(entity.checkInTime),
    checkOutTime: toIso(entity.checkOutTime),
    isLate: entity.isLate,
    lateMinutes: entity.lateMinutes,
    leftEarly: entity.leftEarly,
    attendanceStatus: entity.attendanceStatus,
    verifiedBy: entity.verifiedBy,
    verifiedAt: toIso(entity.verifiedAt),
    note: entity.note,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
