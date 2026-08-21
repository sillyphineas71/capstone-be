/**
 * MKM-PCONF-01 (2026-08-22) — chi tiết xung đột NGƯỜI THAM DỰ cho màn duyệt
 * yêu cầu đặt phòng (MeetingApprovals.jsx).
 *
 * Khác `ConflictDetailDto` (xung đột PHÒNG, đỏ, BE chặn approve bằng
 * ROOM_CONFLICT), xung đột người CHỈ là cảnh báo mềm: Manager vẫn được duyệt
 * cả 2 cuộc họp cùng lúc — người tham dự tự sắp xếp. Vì vậy dữ liệu ở đây
 * phải đủ để Manager tự quyết: cuộc họp nào đang chiếm người, ai bị trùng,
 * bắt buộc hay không.
 *
 * KHÔNG đọc từ `meeting_requests.conflict_summary_json` — cột đó chỉ chụp
 * ảnh {userId, busyFrom, busyTo} tại thời điểm create() nên vừa thiếu thông
 * tin (không có tên người / cuộc họp) vừa cũ (người tham dự có thể đã bị
 * thêm/bớt sau đó). Luôn check TƯƠI như xung đột phòng.
 */
export class ParticipantConflictUserDto {
  userId: string;
  fullName: string | null;
  email: string | null;
  employeeCode: string | null;
  departmentName: string | null;
  avatarUrl: string | null;
  /** true nếu người này là người tham dự BẮT BUỘC của cuộc họp đang xét. */
  isRequired: boolean;
  /** Vai trò trong cuộc họp ĐANG XÉT (host/attendee/...). */
  participantRole: string | null;
  /** Vai trò trong cuộc họp GÂY XUNG ĐỘT — giúp biết họ có thể vắng được không. */
  conflictingRole: string | null;
}

export class ParticipantConflictDetailDto {
  meetingId: string;
  meetingCode: string | null;
  meetingTitle: string | null;
  /** draft | pending_approval | scheduled | in_progress */
  meetingStatus: string | null;
  roomName: string | null;
  hostName: string | null;
  startTime: Date;
  endTime: Date;
  /** Những người vừa dự cuộc họp đang xét, vừa dự cuộc họp này. */
  participants: ParticipantConflictUserDto[];
}

/** Tổng hợp nhanh cho badge/dialog xác nhận duyệt, FE khỏi tự đếm. */
export class ParticipantConflictSummaryDto {
  /** Số NGƯỜI bị trùng (đã khử trùng lặp giữa các cuộc họp). */
  conflictedUserCount: number;
  /** Số người bị trùng mà `isRequired = true`. */
  requiredUserCount: number;
  /** Số cuộc họp khác đang chiếm những người này. */
  meetingCount: number;
}
