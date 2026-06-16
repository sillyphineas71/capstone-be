import { ParticipantConflictItemDto } from './participant-conflict-item.dto.js';

/**
 * External participant trong response.
 */
export class ExternalParticipantDto {
  /** Email của khách mời ngoài tổ chức */
  email: string;

  /** Luôn là 'unknown' vì không có dữ liệu lịch để kiểm tra */
  status: 'unknown';

  /** Message hiển thị: "Không rõ lịch trình" */
  warningMessage: string;
}

/**
 * Response DTO cho POST /api/v1/scheduling/participant-conflicts/check.
 */
export class ParticipantConflictResponseDto {
  /** Có ít nhất một participant bị conflict hay không */
  hasConflict: boolean;

  /** Thời điểm kiểm tra (ISO-8601) */
  checkedAt: string;

  /** Danh sách kết quả từng internal participant */
  participants: ParticipantConflictItemDto[];

  /** Danh sách external participant (luôn trả unknown) */
  externalParticipants: ExternalParticipantDto[];
}
