import * as crypto from 'crypto';

/**
 * guest-invite-token.util — sinh/hash/parse mã bí mật của link mời khách.
 *
 * Link mời có dạng `<externalParticipantId>.<secret>` để tra cứu bằng khóa
 * chính (SELECT ... WHERE id = :epId) rồi mới đối chiếu hash — KHÔNG có
 * bảng/index riêng cho token nên KHÔNG được thiết kế cách tra cứu nào đòi hỏi
 * quét toàn bảng theo tokenHash (spec FR-GLA-003).
 *
 * CHỈ băm SHA-256 của secret được lưu (metadata_json.guestInvite.tokenHash).
 * Secret gốc KHÔNG BAO GIỜ được lưu ở đâu (CLAUDE.md mục 5.4, spec NFR-GLA-003).
 */

const SECRET_BYTE_LENGTH = 32;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** base64url, độ dài tối thiểu tương ứng 32 byte gốc (~43 ký tự, không padding). */
const SECRET_REGEX = /^[A-Za-z0-9_-]{20,}$/;

export interface ParsedGuestInviteToken {
  externalParticipantId: string;
  secret: string;
}

/** Sinh mã bí mật ngẫu nhiên bằng CSPRNG (32 byte, base64url). */
export function generateGuestInviteSecret(): string {
  return crypto.randomBytes(SECRET_BYTE_LENGTH).toString('base64url');
}

/** Băm SHA-256 của secret, trả hex string. */
export function hashGuestInviteSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Ghép `<externalParticipantId>.<secret>` thành link mời đầy đủ. */
export function buildGuestInviteLink(
  baseUrl: string,
  externalParticipantId: string,
  secret: string,
): string {
  return `${baseUrl}/${externalParticipantId}.${secret}`;
}

/**
 * Tách token thành `(externalParticipantId, secret)`.
 *
 * Trả `null` nếu sai định dạng (KHÔNG throw) — caller phải trả cùng mã lỗi
 * `GUEST_INVITE_INVALID` như khi id không tồn tại hoặc hash sai (FR-GLA-028).
 */
export function parseGuestInviteToken(
  token: string,
): ParsedGuestInviteToken | null {
  const dotIndex = token.indexOf('.');
  if (dotIndex <= 0 || dotIndex === token.length - 1) {
    return null;
  }
  const externalParticipantId = token.slice(0, dotIndex);
  const secret = token.slice(dotIndex + 1);
  if (!UUID_REGEX.test(externalParticipantId) || !SECRET_REGEX.test(secret)) {
    return null;
  }
  return { externalParticipantId, secret };
}

/**
 * So sánh hash bằng thời-gian-hằng-số (timing-safe).
 *
 * BẮT BUỘC dùng hàm này khi đối chiếu bí mật — KHÔNG dùng `===`/`==`
 * (NFR-GLA-004). Nếu 2 chuỗi khác độ dài, `timingSafeEqual` throw — bắt lỗi đó
 * và trả `false` thay vì để lộ exception (độ dài hex SHA-256 luôn cố định 64,
 * nên lệch độ dài chỉ xảy ra khi input bất thường).
 */
export function timingSafeEqualHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Hash "dummy" cố định dùng làm vế so sánh khi record không tồn tại — đảm bảo
 * luồng xử lý luôn tốn cùng một khoảng thời gian (hash + timing-safe compare)
 * dù id có tồn tại hay không, chống dò quét qua chênh lệch thời gian phản hồi
 * (research.md rủi ro #3).
 */
export const DUMMY_TOKEN_HASH = hashGuestInviteSecret(
  'dummy-secret-for-timing-parity',
);
