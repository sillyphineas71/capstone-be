import { ApiProperty } from '@nestjs/swagger';

/**
 * UC-99 — Một mục trong timeline cuộc họp (gộp meeting_events / attendance_events / meeting_notes).
 */
export class TimelineItemDto {
  @ApiProperty({ description: 'Thời điểm sự kiện (ISO 8601)' })
  time: string;

  @ApiProperty({
    description: 'Nhóm nguồn',
    enum: ['meeting_event', 'attendance', 'note'],
  })
  category: 'meeting_event' | 'attendance' | 'note';

  @ApiProperty({
    description:
      'Loại sự kiện (meeting_started, check_in, note, warning_sent, ...)',
  })
  type: string;

  @ApiProperty({ description: 'UUID người thực hiện', nullable: true })
  actorUserId: string | null;

  @ApiProperty({ description: 'Tên người thực hiện', nullable: true })
  actorName: string | null;

  @ApiProperty({ description: 'Chi tiết/mô tả', nullable: true })
  detail: string | null;

  @ApiProperty({ description: 'UUID bản ghi nguồn' })
  refId: string;
}
