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
}
