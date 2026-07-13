import { ApiProperty } from '@nestjs/swagger';

/**
 * MKM-AI-01 — data trả về khi tạo AI draft job thành công (HTTP 202, spec 5.5).
 * KHÔNG chứa nội dung transcript (NFR-007) và không có estimatedDurationSeconds
 * (quyết định 2026-07-07 — client theo dõi qua GET /background-jobs/:jobId).
 */
export class AiDraftJobResponseDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'ID bản ghi background_jobs — dùng để poll GET /api/v1/background-jobs/:jobId',
  })
  jobId: string;

  @ApiProperty({ format: 'uuid', description: 'Meeting liên quan' })
  meetingId: string;

  @ApiProperty({ example: 'queued', description: 'Trạng thái job khi tạo' })
  status: string;
}
