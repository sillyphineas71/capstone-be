/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import 'reflect-metadata';
import { AvatarController } from './avatar.controller.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

/**
 * ACCT-AVATAR-SUBMIT-001 — Unit test cho AvatarController (US1 GET route).
 * Trace: FR-003, FR-022, AC-011.
 */
describe('AvatarController', () => {
  let controller: AvatarController;
  let avatarStatusService: { getStatus: jest.Mock };
  let avatarSubmissionService: { submit: jest.Mock };

  beforeEach(() => {
    avatarStatusService = { getStatus: jest.fn() };
    avatarSubmissionService = { submit: jest.fn() };
    controller = new AvatarController(
      avatarStatusService as never,
      avatarSubmissionService as never,
    );
  });

  it('getAvatarStatus gọi service với userId từ CurrentUser', async () => {
    const dto = {
      avatarReviewStatus: 'not_uploaded' as const,
      avatarUrl: null,
      avatarRequired: true,
      shouldShowAvatarPopup: true,
      message: 'msg',
    };
    avatarStatusService.getStatus.mockResolvedValue(dto);

    const result = await controller.getAvatarStatus({ userId: 'u1' });

    expect(avatarStatusService.getStatus).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ success: true, data: dto });
  });

  it('route GET avatar-status yêu cầu permission profile.avatar.read_status', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      AvatarController.prototype.getAvatarStatus,
    );
    expect(permissions).toEqual(['profile.avatar.read_status']);
  });

  it('submitAvatar gọi service với userId, file, consentAccepted', async () => {
    const dto = {
      faceProfileId: 'fp-1',
      avatarReviewStatus: 'pending_review' as const,
      submittedAt: '2026-06-24T10:00:00+07:00',
    };
    avatarSubmissionService.submit.mockResolvedValue(dto);
    const file = {
      buffer: Buffer.from('x'),
      size: 1,
      originalname: 'a.jpg',
      mimetype: 'image/jpeg',
    };

    const result = await controller.submitAvatar({ userId: 'u1' }, file, {
      consentAccepted: true,
    });

    expect(avatarSubmissionService.submit).toHaveBeenCalledWith(
      'u1',
      file,
      true,
    );
    expect(result).toEqual({ success: true, data: dto });
  });

  it('route POST avatar-submission yêu cầu permission profile.avatar.submit (AC-012)', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      AvatarController.prototype.submitAvatar,
    );
    expect(permissions).toEqual(['profile.avatar.submit']);
  });
});
