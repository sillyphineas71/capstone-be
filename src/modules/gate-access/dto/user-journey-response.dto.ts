/**
 * DTO phản hồi UJN-001 — hành trình khuôn viên của MỘT người trong MỘT ngày,
 * ghép 3 KIỂU nguồn (xe qua cổng / check-in họp / hiện diện khu vực) thành 1 timeline.
 *
 * camelCase — khớp convention các DTO đọc của SAVP tầng service (vehicle-history,
 * ivss room access log).
 */

/** 3 KIỂU nguồn, KHÔNG phải 3 camera. Thêm cam zone mới vẫn là type 'zone'. */
export type UserJourneyEventType = 'gate' | 'meeting' | 'zone';

export interface UserJourneyEventDto {
  /** UTC ISO — FE tự convert sang giờ VN để hiển thị. */
  time: string;
  type: UserJourneyEventType;
  /** gate/meeting: enter|leave · zone: appear|disappear. Null nếu nguồn không ghi. */
  direction: string | null;
  /** Câu mô tả người đọc được, dựng sẵn ở BE. */
  detail: string;
  /** Có ở gate + zone; null với meeting. */
  zoneName: string | null;
  /** Chỉ type='gate'. */
  plateNumber: string | null;
  /** Chỉ type='meeting'. */
  roomName: string | null;
  /** Chỉ type='meeting'. */
  meetingId: string | null;
}

export interface UserJourneyResponseDto {
  userId: string;
  fullName: string | null;
  date: string;
  events: UserJourneyEventDto[];
  gateCount: number;
  meetingCount: number;
  /** 0 là BÌNH THƯỜNG khi chưa lắp cam zone — không phải lỗi. */
  zoneCount: number;
}
