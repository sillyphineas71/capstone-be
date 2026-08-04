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
  /** Tên phòng nơi xảy ra event — cần cho route toàn hệ thống (nhiều phòng lẫn nhau). */
  roomId: string | null;
  roomName: string | null;
  direction: string | null;
  /** matched | unmatched_identity | unmatched_location | unmatched_both (ingestion:44-48). */
  matchState: string | null;
  similarity: number | null;
  meetingId: string | null;
  /**
   * [ALS-002] KHÔNG nhận diện được danh tính (`payload_json.userId` NULL).
   *
   * ⚠ ĐÃ ĐỔI NGHĨA so với bản đầu: trước đây = `matchState.startsWith('unmatched')`,
   * khiến người ĐÃ nhận diện được nhưng vào phòng không có lịch họp
   * (`unmatched_location`) cũng bị gắn cờ "người lạ" — sai nghĩa đen. Ngữ nghĩa cũ
   * được giữ nguyên ở {@link isUnmatched} để FE đang dùng không vỡ.
   */
  isStranger: boolean;
  /** [ALS-002] Ngữ nghĩa CŨ của isStranger: matchState bắt đầu bằng 'unmatched'. */
  isUnmatched: boolean;
}

export interface AccessLogPaginationDto {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface RoomAccessLogResponseDto {
  /** null ở route toàn hệ thống (GET /ivss/access-log). */
  roomId: string | null;
  /** null ở route toàn hệ thống. */
  roomName: string | null;
  date: string;
  /**
   * Tổng số event khớp bộ lọc (TOÀN BỘ, không chỉ trang hiện tại) — bằng
   * `pagination.total`. Giữ tên cũ cho FE đang đọc field này.
   */
  totalEvents: number;
  /** Đếm trên TOÀN BỘ kết quả lọc, không phải chỉ trang hiện tại. */
  matchedCount: number;
  /** Đếm theo ngữ nghĩa `isUnmatched` (matchState 'unmatched*'), toàn bộ kết quả lọc. */
  unmatchedCount: number;
  pagination: AccessLogPaginationDto;
  events: RoomAccessLogEventDto[];
}
