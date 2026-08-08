/**
 * Nhóm E (2026-08-08) — chi tiết 1 booking đang gây xung đột, enrich từ
 * `meeting_requests.conflict_summary_json.conflicts[].bookingId` (vốn chỉ có
 * id thô) sang tên phòng/tên cuộc họp/tên host để hiển thị cho Manager
 * (MeetingApprovals) và đính kèm vào notification reject.
 */
export class ConflictDetailDto {
  bookingId: string;
  roomName: string | null;
  meetingTitle: string | null;
  startTime: Date;
  endTime: Date;
  hostName: string | null;
}
