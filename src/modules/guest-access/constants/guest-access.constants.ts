/**
 * Hằng số dùng chung cho luồng khách ngoài công ty (guest access).
 *
 * Xem spec: spec/features/guest-access/feat-external-guest-live-meeting-access/.
 */

/**
 * Giá trị bắt buộc của claim `typ` trong token phiên khách.
 *
 * Token khách đã được ký bằng secret RIÊNG (`GUEST_TOKEN_SECRET`), nên về lý
 * thuyết không thể lẫn với token nhân viên. Claim này là lớp phòng thủ thứ hai:
 * nếu ai đó lỡ cấu hình 2 secret trùng nhau, verify vẫn từ chối token sai loại.
 */
export const GUEST_TOKEN_TYPE = 'guest';

/** Scope duy nhất ở v1: xem nội dung cuộc họp bản rút gọn. */
export const GUEST_SCOPE_VIEW = 'meeting.guest.view';

/**
 * Khóa `metadata_json` chứa dữ liệu lời mời trong `meeting_external_participants`.
 *
 * Do ràng buộc KHÔNG được thêm bảng mới, toàn bộ trạng thái bền của lời mời nằm
 * dưới đúng một nhánh này. Mọi thao tác ghi PHẢI dùng `jsonb_set` (xem
 * `GuestInviteRepository`/`GuestInviteService`) để không xóa mất các key khác
 * của `metadata_json`.
 */
export const GUEST_INVITE_METADATA_KEY = 'guestInvite';

export enum GuestInviteStatus {
  ACTIVE = 'active',
  USED = 'used',
  REVOKED = 'revoked',
}

export enum GuestLobbyStatus {
  WAITING = 'waiting',
  ADMITTED = 'admitted',
  REJECTED = 'rejected',
}

/** event_type ghi vào attendance_events cho khách — KHÔNG dùng chung với check_in/check_out. */
export const GUEST_ATTENDANCE_EVENT_TYPE = {
  JOIN: 'guest_join',
  LEAVE: 'guest_leave',
} as const;

export const GUEST_ATTENDANCE_SOURCE_TYPE = 'guest_portal';

/**
 * Prefix key Redis.
 *
 * Lưu ý: `REDIS_KEY_PREFIX` đã được set ở cấp ioredis client, nên các key ở đây
 * KHÔNG tự thêm prefix ứng dụng nữa.
 */
export const GUEST_REDIS_KEYS = {
  /** Hash SHA-256 của OTP hiện tại của một lời mời. */
  otp: (inviteId: string): string => `guest:otp:${inviteId}`,
  /** Bộ đếm số lần nhập sai OTP liên tiếp — BẮT BUỘC dùng INCR (atomic). */
  otpAttempt: (inviteId: string): string => `guest:otp_attempt:${inviteId}`,
  /** Bộ đếm số lần yêu cầu gửi OTP trong cửa sổ hiện tại — chống spam mail. */
  otpSend: (inviteId: string): string => `guest:otp_send:${inviteId}`,
  /** Cờ khóa tạm một lời mời sau khi nhập sai OTP quá số lần cho phép. */
  otpBlocked: (inviteId: string): string => `guest:otp_blocked:${inviteId}`,
  /** Metadata phiên khách đang hoạt động, key theo jti. */
  session: (jti: string): string => `guest:session:${jti}`,
  /** Đánh dấu một phiên cụ thể đã bị thu hồi (ví dụ: host từ chối ở lobby). */
  revoked: (jti: string): string => `guest:revoked:${jti}`,
  /**
   * Mốc thời gian vô hiệu hóa MỌI phiên của một lời mời.
   * Mirror pattern `auth:user:<id>:invalid_after` của luồng đổi mật khẩu.
   */
  inviteInvalidAfter: (inviteId: string): string =>
    `guest:invite:${inviteId}:invalid_after`,
  /** jti mới nhất đã cấp cho một lời mời — dùng để tra ngược khi reject/revoke. */
  inviteCurrentJti: (inviteId: string): string =>
    `guest:invite:${inviteId}:current_jti`,
  /** Hàng chờ duyệt vào của một cuộc họp (Redis SET các inviteId). */
  lobby: (meetingId: string): string => `guest:lobby:${meetingId}`,
  /** Trạng thái phòng chờ hiện tại của một lời mời cụ thể. */
  lobbyStatus: (inviteId: string): string => `guest:lobby:status:${inviteId}`,
  /** Ghi nhớ thiết bị đã xác minh OTP — cho phép bỏ qua OTP lần sau. */
  device: (inviteId: string, deviceId: string): string =>
    `guest:device:${inviteId}:${deviceId}`,
} as const;
