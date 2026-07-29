/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import 'reflect-metadata';
import { AvatarPhotoController } from './avatar-photo.controller.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

/**
 * ACCT-AVATAR-PHOTO-001 — Unit test cho AvatarPhotoController.
 */
describe('AvatarPhotoController', () => {
  let controller: AvatarPhotoController;
  let avatarPhotoService: { updateAvatarPhoto: jest.Mock };

  beforeEach(() => {
    avatarPhotoService = { updateAvatarPhoto: jest.fn() };
    controller = new AvatarPhotoController(avatarPhotoService as never);
  });

  it('updateAvatar gọi service với userId, file', async () => {
    const dto = {
      avatarUrl: 'https://res.cloudinary.com/demo/avatars/x.jpg',
      updatedAt: '2026-07-29T10:00:00+07:00',
    };
    avatarPhotoService.updateAvatarPhoto.mockResolvedValue(dto);
    const file = {
      buffer: Buffer.from('x'),
      size: 1,
      originalname: 'a.jpg',
      mimetype: 'image/jpeg',
    };

    const result = await controller.updateAvatar({ userId: 'u1' }, file);

    expect(avatarPhotoService.updateAvatarPhoto).toHaveBeenCalledWith(
      'u1',
      file,
    );
    expect(result).toEqual({
      success: true,
      message: 'Cập nhật ảnh đại diện thành công',
      data: dto,
    });
  });

  it('route POST avatar yêu cầu permission profile.avatar.update', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      AvatarPhotoController.prototype.updateAvatar,
    );
    expect(permissions).toEqual(['profile.avatar.update']);
  });
});
