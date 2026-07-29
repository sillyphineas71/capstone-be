import type { BiometricReviewStatus } from '../../../common/utils/biometric-status-resolver.util.js';

/**
 * ACCT-BIOMETRIC-SUBMIT-001 (FR-005) — Response cho GET /api/v1/me/biometric-status.
 *
 * `avatarUrl` GIỮ NGUYÊN tên field — nhưng từ nay chỉ đọc thẳng `users.avatar_url`,
 * do feature độc lập `feat-update-avatar-photo` quản lý, KHÔNG còn liên quan đến
 * kết quả duyệt sinh trắc học (xem feat-split-avatar-and-biometric/plan.md quyết định D2).
 */
export class BiometricStatusResponseDto {
  biometricReviewStatus: BiometricReviewStatus;
  avatarUrl: string | null;
  biometricRequired: boolean;
  shouldShowBiometricPopup: boolean;
  message: string;
}
