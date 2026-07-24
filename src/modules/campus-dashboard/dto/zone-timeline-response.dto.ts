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
  totalDurationSeconds: number | null;
  ongoing: boolean;
  message?: string;
}
