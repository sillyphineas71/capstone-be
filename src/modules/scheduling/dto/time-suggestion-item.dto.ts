/**
 * BusyParticipantDto — chỉ optional participants đang bận (required luôn rảnh
 * do FR-004 là hard filter). Không kèm meeting title/roomId (BR1, FR-030).
 */
export class BusyParticipantDto {
  userId: string;
  busyFrom: string;
  busyTo: string;
}

/**
 * TimeSuggestionItemDto — 1 khung giờ đề xuất trong response
 * POST /api/v1/scheduling/time-suggestions (UC-SM-02).
 */
export class TimeSuggestionItemDto {
  startTime: string;
  endTime: string;
  /** 0-100, xem FR-028 */
  matchScore: number;
  requiredFreeCount: number;
  requiredTotal: number;
  optionalFreeCount: number;
  optionalTotal: number;
  busyParticipants: BusyParticipantDto[];
}
