import { NotFoundException } from '@nestjs/common';
import { AvatarStatusService } from './avatar-status.service.js';

/**
 * ACCT-AVATAR-SUBMIT-001 — Unit test cho AvatarStatusService (US1).
 * Trace: AC-001, AC-003, AC-003b, AC-004, AC-006, AC-016, AC-017.
 */
describe('AvatarStatusService', () => {
  let service: AvatarStatusService;
  let userRepo: { findOne: jest.Mock };
  let faceProfileRepo: { find: jest.Mock };

  beforeEach(() => {
    userRepo = { findOne: jest.fn() };
    faceProfileRepo = { find: jest.fn() };
    service = new AvatarStatusService(
      userRepo as never,
      faceProfileRepo as never,
    );
  });

  it('user không tồn tại → NotFoundException USER_NOT_FOUND', async () => {
    userRepo.findOne.mockResolvedValue(null);
    await expect(service.getStatus('u1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('không có face profile → not_uploaded, popup=true (AC-001)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', avatarUrl: null });
    faceProfileRepo.find.mockResolvedValue([]);

    const result = await service.getStatus('u1');
    expect(result.avatarReviewStatus).toBe('not_uploaded');
    expect(result.shouldShowAvatarPopup).toBe(true);
    expect(result.avatarRequired).toBe(true);
    expect(result.avatarUrl).toBeNull();
  });

  it('approved: status=active, avatarUrl lấy từ users.avatar_url (AC-006)', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'u1',
      avatarUrl: 'https://res.cloudinary.com/demo/a.jpg',
    });
    faceProfileRepo.find.mockResolvedValue([
      { status: 'active', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.getStatus('u1');
    expect(result.avatarReviewStatus).toBe('approved');
    expect(result.avatarRequired).toBe(false);
    expect(result.avatarUrl).toBe('https://res.cloudinary.com/demo/a.jpg');
  });

  it('active + pending_review → pending_review (AC-003 case trọng yếu)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', avatarUrl: 'x' });
    faceProfileRepo.find.mockResolvedValue([
      { status: 'active', lastUpdatedAt: null, enrolledAt: null },
      { status: 'pending_review', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.getStatus('u1');
    expect(result.avatarReviewStatus).toBe('pending_review');
    expect(result.shouldShowAvatarPopup).toBe(false);
  });

  it('rejected thật → message "bị từ chối" (AC-004)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', avatarUrl: null });
    faceProfileRepo.find.mockResolvedValue([
      { status: 'rejected', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.getStatus('u1');
    expect(result.avatarReviewStatus).toBe('rejected');
    expect(result.message).toContain('bị từ chối');
  });

  it('disabled → rejected, message trung tính không lộ lý do (AC-016)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', avatarUrl: null });
    faceProfileRepo.find.mockResolvedValue([
      { status: 'disabled', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.getStatus('u1');
    expect(result.avatarReviewStatus).toBe('rejected');
    expect(result.shouldShowAvatarPopup).toBe(true);
    expect(result.message).not.toContain('từ chối');
    expect(result.message).toContain('không còn hợp lệ');
  });

  it('revoked → rejected, message trung tính (AC-017)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', avatarUrl: null });
    faceProfileRepo.find.mockResolvedValue([
      { status: 'revoked', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.getStatus('u1');
    expect(result.avatarReviewStatus).toBe('rejected');
    expect(result.message).not.toContain('từ chối');
  });
});
