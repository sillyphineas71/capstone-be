import {
  resolveAvatarReviewStatus,
  FaceProfileStatusRow,
} from './avatar-status-resolver.util.js';

/**
 * ACCT-AVATAR-SUBMIT-001 — Unit test cho resolveAvatarReviewStatus (BR-004/005/006).
 * Trace: AC-001, AC-003, AC-003b, AC-004, AC-006, AC-016, AC-017, EC-007.
 */
const row = (
  status: FaceProfileStatusRow['status'],
  overrides: Partial<FaceProfileStatusRow> = {},
): FaceProfileStatusRow => ({
  status,
  lastUpdatedAt: null,
  enrolledAt: null,
  ...overrides,
});

describe('resolveAvatarReviewStatus (BR-004)', () => {
  it('không có row → not_uploaded, avatarRequired=true, popup=true (AC-001)', () => {
    expect(resolveAvatarReviewStatus([])).toEqual({
      avatarReviewStatus: 'not_uploaded',
      avatarRequired: true,
      shouldShowAvatarPopup: true,
    });
  });

  it('chỉ pending_review → pending_review, popup=false (AC-003b)', () => {
    expect(resolveAvatarReviewStatus([row('pending_review')])).toEqual({
      avatarReviewStatus: 'pending_review',
      avatarRequired: true,
      shouldShowAvatarPopup: false,
    });
  });

  it('chỉ active → approved, avatarRequired=false, popup=false (AC-006)', () => {
    expect(resolveAvatarReviewStatus([row('active')])).toEqual({
      avatarReviewStatus: 'approved',
      avatarRequired: false,
      shouldShowAvatarPopup: false,
    });
  });

  it('chỉ rejected → rejected, popup=true (AC-004)', () => {
    expect(resolveAvatarReviewStatus([row('rejected')])).toEqual({
      avatarReviewStatus: 'rejected',
      avatarRequired: true,
      shouldShowAvatarPopup: true,
    });
  });

  it('chỉ disabled → rejected, popup=true (AC-016)', () => {
    expect(resolveAvatarReviewStatus([row('disabled')]).avatarReviewStatus).toBe(
      'rejected',
    );
    expect(
      resolveAvatarReviewStatus([row('disabled')]).shouldShowAvatarPopup,
    ).toBe(true);
  });

  it('chỉ revoked → rejected, popup=true (AC-017)', () => {
    expect(resolveAvatarReviewStatus([row('revoked')]).avatarReviewStatus).toBe(
      'rejected',
    );
  });

  it('active + pending_review → pending_review (case trọng yếu AC-003/AC-006b)', () => {
    expect(
      resolveAvatarReviewStatus([row('active'), row('pending_review')])
        .avatarReviewStatus,
    ).toBe('pending_review');
  });

  it('pending_review + revoked → pending_review (EC-007 bước 1 thắng)', () => {
    expect(
      resolveAvatarReviewStatus([row('revoked'), row('pending_review')])
        .avatarReviewStatus,
    ).toBe('pending_review');
  });

  it('active + revoked (không pending) → approved (EC-007 bước 2 thắng)', () => {
    expect(
      resolveAvatarReviewStatus([row('revoked'), row('active')])
        .avatarReviewStatus,
    ).toBe('approved');
  });

  it('hỗn hợp active + rejected + disabled (không pending) → approved', () => {
    expect(
      resolveAvatarReviewStatus([
        row('rejected'),
        row('active'),
        row('disabled'),
      ]).avatarReviewStatus,
    ).toBe('approved');
  });
});
