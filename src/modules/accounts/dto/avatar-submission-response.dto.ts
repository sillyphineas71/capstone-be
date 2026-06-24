/**
 * ACCT-AVATAR-SUBMIT-001 (FR-024) — Response cho POST /api/v1/me/avatar-submission.
 */
export class AvatarSubmissionResponseDto {
  faceProfileId: string;
  avatarReviewStatus: 'pending_review';
  submittedAt: string;
}
