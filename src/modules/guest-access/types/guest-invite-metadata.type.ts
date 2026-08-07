import { GuestInviteStatus } from '../constants/guest-access.constants.js';

/**
 * Hình dạng nhánh `guestInvite` trong `meeting_external_participants.metadata_json`.
 *
 * Xem data-model.md mục 2. Toàn bộ object này được ghi đè NGUYÊN KHỐI mỗi lần
 * cập nhật qua `jsonb_set` — không patch từng field con.
 */
export interface GuestInviteMetadata {
  /** SHA-256(secret), hex — KHÔNG BAO GIỜ lưu secret gốc. */
  tokenHash: string;
  issuedAt: string;
  /** user_id của host/admin đã thực hiện approve/resend. */
  issuedBy: string;
  expiresAt: string;
  status: GuestInviteStatus;
  /** ISO datetime | null — set khi host revoke hoặc meeting cancelled/completed. */
  invalidAfter: string | null;
  firstJoinedAt: string | null;
  lastJoinedAt: string | null;
}

export interface GuestInviteIssueResult {
  externalParticipantId: string;
  email: string;
  /** Mã bí mật gốc — CHỈ tồn tại trong bộ nhớ tức thời để ghép link gửi mail. */
  secret: string;
  /** Link đầy đủ đã ghép `<baseUrl>/<epId>.<secret>` — sẵn sàng đưa vào mail. */
  link: string;
  guestInvite: GuestInviteMetadata;
}
