import { ApiProperty } from '@nestjs/swagger';

/**
 * MKM-AI-03 — GET /meetings/:meetingId/minutes/ai-draft-config.
 * Tập con AN TOÀN của system_configs['ai.minutes_summary'] để FE quyết định
 * hiện/ẩn nút "Tạo bằng AI" + banner "cần review". KHÔNG expose provider/
 * modelName/maxInputTokens/temperature/retentionDays/logRawTranscript/
 * allowExternalProvider — đó là chi tiết vận hành nội bộ (spec 3.1 FR-002).
 */
export class AiDraftConfigDto {
  @ApiProperty({
    description: 'true nếu tính năng AI draft đang bật cho toàn hệ thống',
  })
  enabled: boolean;

  @ApiProperty({
    description:
      'true nếu nghiệp vụ yêu cầu FE luôn hiện banner "cần review trước khi ban hành"',
  })
  requireHumanReview: boolean;

  constructor(data: AiDraftConfigDto) {
    Object.assign(this, data);
  }
}
