import { randomUUID } from 'crypto';

/**
 * ACCT-AVATAR-SUBMIT-001 (BR-PROFILE-CODE): Generator `profile_code` dùng chung
 * cho cả self-service avatar submission VÀ UC-17 admin-driven face enrollment.
 *
 * Format: `FP-${UUID_WITHOUT_DASHES_UPPERCASE}` (ví dụ: FP-550E8400E29B41D4A716446655440000).
 */
export function generateFaceProfileCode(): string {
  return `FP-${randomUUID().replace(/-/g, '').toUpperCase()}`;
}
