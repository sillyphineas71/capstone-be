import type { AvatarReviewStatus } from '../../../common/utils/avatar-status-resolver.util.js';

/**
 * ACCT-AVATAR-SUBMIT-001 (FR-005) — Response cho GET /api/v1/me/avatar-status.
 */
export class AvatarStatusResponseDto {
  avatarReviewStatus: AvatarReviewStatus;
  avatarUrl: string | null;
  avatarRequired: boolean;
  shouldShowAvatarPopup: boolean;
  message: string;
}
