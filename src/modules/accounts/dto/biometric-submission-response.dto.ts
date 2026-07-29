/**
 * ACCT-BIOMETRIC-SUBMIT-001 (FR-024) — Response cho POST /api/v1/me/biometric-submission.
 */
export class BiometricSubmissionResponseDto {
  faceProfileId: string;
  biometricReviewStatus: 'pending_review';
  submittedAt: string;
}
