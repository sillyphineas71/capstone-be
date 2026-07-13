import { ApiProperty } from '@nestjs/swagger';

/**
 * MKM-AI-02 — 1 phần tử trong danh sách AI draft job của một meeting
 * (GET /meetings/:meetingId/minutes/ai-draft-jobs). FE dùng để resume polling
 * sau reload: lấy job mới nhất / job đang chạy để tiếp tục theo dõi tiến độ.
 *
 * CHỦ ĐÍCH chỉ expose field theo dõi tiến độ + lấy kết quả — KHÔNG trả
 * input_json/metadata_json (dữ liệu nội bộ nhạy cảm) và KHÔNG trả requestedBy
 * (đã dùng để authorize), nhất quán với BackgroundJobStatusResponseDto.
 */
export class AiDraftJobSummaryDto {
  @ApiProperty({ format: 'uuid', description: 'ID background_jobs' })
  jobId: string;

  @ApiProperty({
    description:
      'queued | running | retrying | completed | failed | cancelled | scheduled',
  })
  status: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  scheduledAt: Date | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  startedAt: Date | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  completedAt: Date | null;

  @ApiProperty({
    nullable: true,
    description: 'Chỉ có giá trị khi status=failed — error code/message ngắn.',
  })
  errorMessage: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Chỉ có giá trị khi status=completed — output_json (vd { minutesId, meetingId, status }).',
  })
  result: Record<string, unknown> | null;

  constructor(data: AiDraftJobSummaryDto) {
    Object.assign(this, data);
  }
}
