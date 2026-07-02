import { ApiProperty } from '@nestjs/swagger';
import { BackgroundJobStatus } from '../entities/background-job.entity.js';

/**
 * Shape status tối giản trả cho client khi poll 1 background job
 * (GET /api/v1/background-jobs/:id — T007).
 *
 * CHỦ ĐÍCH chỉ expose field cần cho việc theo dõi tiến độ job + lấy kết quả:
 * KHÔNG trả `inputJson`/`metadataJson` (chứa tham chiếu nội bộ như
 * sourceMediaFileId, storage key... — dữ liệu nhạy cảm theo CLAUDE.md mục 20.2),
 * KHÔNG trả `requestedBy` (đã dùng để authorize, không cần lộ ngược ra response).
 * `result` chỉ lấy từ `outputJson` (kết quả job, vd transcription =
 * `{ transcriptId, status }`) — client dùng để gọi tiếp GET transcript.
 */
export class BackgroundJobStatusResponseDto {
  @ApiProperty({
    description: 'ID của background job (chính là jobId trả về khi tạo job)',
  })
  jobId: string;

  @ApiProperty({ description: 'Loại job, vd transcription' })
  jobType: string;

  @ApiProperty({
    enum: BackgroundJobStatus,
    description:
      'Trạng thái job: queued | scheduled | running | completed | failed | cancelled | retrying',
  })
  status: BackgroundJobStatus;

  @ApiProperty({
    nullable: true,
    description: 'Loại entity liên quan, vd meeting',
  })
  relatedEntityType: string | null;

  @ApiProperty({
    nullable: true,
    description: 'ID entity liên quan, vd meetingId',
  })
  relatedEntityId: string | null;

  @ApiProperty({ description: 'Số lần đã retry' })
  retryCount: number;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  scheduledAt: Date | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  startedAt: Date | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  completedAt: Date | null;

  @ApiProperty({
    nullable: true,
    description:
      'Chỉ có giá trị khi status=failed — error code/message ngắn từ worker, không phải stack trace.',
  })
  errorMessage: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Chỉ có giá trị khi status=completed — outputJson của job (vd { transcriptId, status }).',
  })
  result: Record<string, unknown> | null;

  @ApiProperty({
    nullable: true,
    description: 'media_files.id của output (vd export report), nếu có',
  })
  outputFileId: string | null;
}
