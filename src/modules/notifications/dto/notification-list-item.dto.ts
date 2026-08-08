export class NotificationListItemDto {
  id: string;
  notificationType: string;
  subject: string | null;
  content: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  priority: string;
  createdAt: Date;
  /** [BE-07] Trạng thái đã đọc — nguồn Redis, xem NotificationReadStateService. */
  isRead: boolean;
  /**
   * [Nhóm E, 2026-08-08] Dữ liệu cấu trúc bổ sung tùy notificationType — ví dụ
   * `meeting_request_rejected` có thể mang `{conflictDetails, suggestedAlternatives}`.
   * Cột `payload_json` đã tồn tại sẵn trong baseline, trước đây bị lọc bỏ ở DTO này.
   */
  payloadJson: Record<string, unknown> | null;
}
