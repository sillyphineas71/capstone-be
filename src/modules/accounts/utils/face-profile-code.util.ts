import { randomUUID } from 'crypto';

/**
 * ACCT-BIOMETRIC-SUBMIT-001 (BR-PROFILE-CODE) [ĐỔI TỪ ACCT-AVATAR-SUBMIT-001 2026-07-29]:
 * Generator `profile_code` dùng chung cho cả self-service biometric submission VÀ
 * UC-17 admin-driven face enrollment.
 *
 * Format: `FP-${UUID_WITHOUT_DASHES_UPPERCASE}` (ví dụ: FP-550E8400E29B41D4A716446655440000).
 */
export function generateFaceProfileCode(): string {
  return `FP-${randomUUID().replace(/-/g, '').toUpperCase()}`;
}
