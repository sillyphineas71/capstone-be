/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import 'reflect-metadata';
import { BiometricSubmissionController } from './biometric-submission.controller.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

/**
 * ACCT-BIOMETRIC-SUBMIT-001 — Unit test cho BiometricSubmissionController (US1 GET route).
 * Trace: FR-003, FR-022, AC-011.
 */
describe('BiometricSubmissionController', () => {
  let controller: BiometricSubmissionController;
  let biometricStatusService: { getStatus: jest.Mock };
  let biometricSubmissionService: { submit: jest.Mock };

  beforeEach(() => {
    biometricStatusService = { getStatus: jest.fn() };
    biometricSubmissionService = { submit: jest.fn() };
    controller = new BiometricSubmissionController(
      biometricStatusService as never,
      biometricSubmissionService as never,
    );
  });

  it('getBiometricStatus gọi service với userId từ CurrentUser', async () => {
    const dto = {
      biometricReviewStatus: 'not_uploaded' as const,
      avatarUrl: null,
      biometricRequired: true,
      shouldShowBiometricPopup: true,
      message: 'msg',
    };
    biometricStatusService.getStatus.mockResolvedValue(dto);

    const result = await controller.getBiometricStatus({ userId: 'u1' });

    expect(biometricStatusService.getStatus).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ success: true, data: dto });
  });

  it('route GET biometric-status yêu cầu permission profile.biometric.read_status', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      BiometricSubmissionController.prototype.getBiometricStatus,
    );
    expect(permissions).toEqual(['profile.biometric.read_status']);
  });

  it('submitBiometric gọi service với userId, file, consentAccepted', async () => {
    const dto = {
      faceProfileId: 'fp-1',
      biometricReviewStatus: 'pending_review' as const,
      submittedAt: '2026-06-24T10:00:00+07:00',
    };
    biometricSubmissionService.submit.mockResolvedValue(dto);
    const file = {
      buffer: Buffer.from('x'),
      size: 1,
      originalname: 'a.jpg',
      mimetype: 'image/jpeg',
    };

    const result = await controller.submitBiometric({ userId: 'u1' }, file, {
      consentAccepted: true,
    });

    expect(biometricSubmissionService.submit).toHaveBeenCalledWith(
      'u1',
      file,
      true,
    );
    expect(result).toEqual({ success: true, data: dto });
  });

  it('route POST biometric-submission yêu cầu permission profile.biometric.submit (AC-012)', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      BiometricSubmissionController.prototype.submitBiometric,
    );
    expect(permissions).toEqual(['profile.biometric.submit']);
  });
});
