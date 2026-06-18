import * as crypto from 'crypto';

/**
 * secret-crypto.util (IOT-015) — mã hóa đối xứng secret bằng AES-256-GCM.
 *
 * - Key = sha256(RTSP_CRED_KEY) → 32 byte, derive LAZY tại call-time (đọc process.env mỗi lần).
 * - IV ngẫu nhiên 12 byte mỗi lần encrypt (GCM nonce) ⇒ cùng plaintext → blob khác nhau.
 * - blob = base64( iv[12] ‖ authTag[16] ‖ ciphertext ).
 * - AES-GCM authenticated: decrypt ném lỗi nếu tag/key sai (chống tamper).
 * - Dùng node core `crypto`, KHÔNG lib ngoài. TUYỆT ĐỐI không log plaintext/blob/key (SEC-01).
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function deriveKey(): Buffer {
  const raw = process.env.RTSP_CRED_KEY;
  if (!raw) {
    throw new Error('RTSP_CRED_KEY is not configured');
  }
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptSecret(blob: string): string {
  const key = deriveKey();
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid encrypted blob');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}
