/**
 * Một participant trong kết quả kiểm tra xung đột lịch.
 */
export class BusySlotDto {
  /** Thời gian bắt đầu bận (ISO-8601) */
  busyFrom: string;

  /** Thời gian kết thúc bận (ISO-8601) */
  busyTo: string;
}

/**
 * Kết quả kiểm tra xung đột lịch cho một participant.
 */
export class ParticipantConflictItemDto {
  /** User ID của participant */
  userId: string;

  /** Trạng thái lịch: free (rảnh), busy (bận), unknown (không xác định) */
  status: 'free' | 'busy' | 'unknown';

  /** Các khoảng thời gian bị bận (chỉ có khi status = busy) */
  busySlots: BusySlotDto[];

  /** Có cần hiển thị cảnh báo trên UI không */
  displayWarning: boolean;

  /** Message cảnh báo hiển thị, null nếu không có conflict */
  warningMessage: string | null;
}
