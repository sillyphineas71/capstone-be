export interface TimelineEventDto {
  eventTime: string;
  eventType: string;
  occupancyCount: number | null;
  userId: string | null;
}

export interface ZoneTimelineResponseDto {
  events: TimelineEventDto[];
  /** BR1: null nếu không xác định được (zone rỗng); false nếu zone chỉ có event userId=NULL. */
  personDataAvailable: boolean | null;
  /** Số lượt "bắt gặp" (event appear) của user trong khoảng thời gian; null khi không truyền userId. */
  sightingCount: number | null;
  message?: string;
}
