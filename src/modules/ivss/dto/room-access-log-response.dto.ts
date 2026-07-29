/**
 * DTO phản hồi RAL-001 (Màn 2 — Nhật ký ra/vào theo PHÒNG + NGÀY).
 *
 * camelCase — khớp convention module ivss (mirror getMeetingPresence của Màn 1),
 * KHÁC các module SAVP (zones/gate-access/anpr) vốn dùng snake_case.
 */

export interface RoomAccessLogEventDto {
  id: string;
  eventTime: string;
  userId: string | null;
  fullName: string | null;
  direction: string | null;
  matchState: string | null;
  similarity: number | null;
  meetingId: string | null;
  /** matchState bắt đầu bằng 'unmatched' → người lạ/ngoài lịch (tín hiệu an ninh cho FE). */
  isStranger: boolean;
}

export interface RoomAccessLogResponseDto {
  roomId: string;
  roomName: string | null;
  date: string;
  totalEvents: number;
  matchedCount: number;
  unmatchedCount: number;
  events: RoomAccessLogEventDto[];
}
