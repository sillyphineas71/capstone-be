import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AttendanceItemDto {
  @ApiProperty({ format: 'uuid' })
  participantId: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty()
  fullName: string;

  @ApiPropertyOptional({ nullable: true })
  departmentName: string | null;

  @ApiPropertyOptional({ nullable: true })
  positionTitle: string | null;

  @ApiProperty({ enum: ['host', 'attendee', 'approver', 'note_taker'] })
  participantRole: string;

  @ApiProperty({ enum: ['present', 'late', 'absent', 'left_early', 'not_checked_in', 'pending_review'] })
  attendanceStatus: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  checkInTime: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Only returned if user has permission' })
  attendanceSource: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Only returned if user has permission' })
  checkInMethod: string | null;

  @ApiProperty()
  isLate: boolean;

  @ApiProperty()
  lateMinutes: number;

  constructor(partial: Partial<AttendanceItemDto>) {
    Object.assign(this, partial);
  }
}
