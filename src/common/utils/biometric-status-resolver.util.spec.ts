import {
  resolveBiometricReviewStatus,
  FaceProfileStatusRow,
} from './biometric-status-resolver.util.js';

/**
 * ACCT-BIOMETRIC-SUBMIT-001 — Unit test cho resolveBiometricReviewStatus (BR-004/005/006).
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

describe('resolveBiometricReviewStatus (BR-004)', () => {
  it('không có row → not_uploaded, biometricRequired=true, popup=true (AC-001)', () => {
    expect(resolveBiometricReviewStatus([])).toEqual({
      biometricReviewStatus: 'not_uploaded',
      biometricRequired: true,
      shouldShowBiometricPopup: true,
    });
  });

  it('chỉ pending_review → pending_review, popup=false (AC-003b)', () => {
    expect(resolveBiometricReviewStatus([row('pending_review')])).toEqual({
      biometricReviewStatus: 'pending_review',
      biometricRequired: true,
      shouldShowBiometricPopup: false,
    });
  });

  it('chỉ active → approved, biometricRequired=false, popup=false (AC-006)', () => {
    expect(resolveBiometricReviewStatus([row('active')])).toEqual({
      biometricReviewStatus: 'approved',
      biometricRequired: false,
      shouldShowBiometricPopup: false,
    });
  });

  it('chỉ rejected → rejected, popup=true (AC-004)', () => {
    expect(resolveBiometricReviewStatus([row('rejected')])).toEqual({
      biometricReviewStatus: 'rejected',
      biometricRequired: true,
      shouldShowBiometricPopup: true,
    });
  });

  it('chỉ disabled → rejected, popup=true (AC-016)', () => {
    expect(
      resolveBiometricReviewStatus([row('disabled')]).biometricReviewStatus,
    ).toBe('rejected');
    expect(
      resolveBiometricReviewStatus([row('disabled')]).shouldShowBiometricPopup,
    ).toBe(true);
  });

  it('chỉ revoked → rejected, popup=true (AC-017)', () => {
    expect(
      resolveBiometricReviewStatus([row('revoked')]).biometricReviewStatus,
    ).toBe('rejected');
  });

  it('active + pending_review → pending_review (case trọng yếu AC-003/AC-006b)', () => {
    expect(
      resolveBiometricReviewStatus([row('active'), row('pending_review')])
        .biometricReviewStatus,
    ).toBe('pending_review');
  });

  it('pending_review + revoked → pending_review (EC-007 bước 1 thắng)', () => {
    expect(
      resolveBiometricReviewStatus([row('revoked'), row('pending_review')])
        .biometricReviewStatus,
    ).toBe('pending_review');
  });

  it('active + revoked (không pending) → approved (EC-007 bước 2 thắng)', () => {
    expect(
      resolveBiometricReviewStatus([row('revoked'), row('active')])
        .biometricReviewStatus,
    ).toBe('approved');
  });

  it('hỗn hợp active + rejected + disabled (không pending) → approved', () => {
    expect(
      resolveBiometricReviewStatus([
        row('rejected'),
        row('active'),
        row('disabled'),
      ]).biometricReviewStatus,
    ).toBe('approved');
  });
});
