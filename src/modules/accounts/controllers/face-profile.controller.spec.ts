/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { BadRequestException } from '@nestjs/common';
import { FaceProfileController } from './face-profile.controller.js';

describe('FaceProfileController (FPE-001)', () => {
  let controller: FaceProfileController;
  let serviceMock: any;

  beforeEach(() => {
    serviceMock = { enrollPortrait: jest.fn() };
    controller = new FaceProfileController(serviceMock);
  });

  it('enroll → envelope {success,message,data}', async () => {
    serviceMock.enrollPortrait.mockResolvedValue({
      faceProfileId: 'fp-1',
      mediaFileId: 'media-1',
      status: 'pending_review',
    });
    const file = { buffer: Buffer.from('x'), mimetype: 'image/jpeg', size: 10 };
    const r = await controller.enroll('u1', file, { user: { sub: 'admin' } });
    expect(serviceMock.enrollPortrait).toHaveBeenCalledWith(
      'u1',
      file,
      'admin',
    );
    expect(r.success).toBe(true);
    expect(r.message).toBe('Face portrait enrolled');
    expect(r.data).toMatchObject({ faceProfileId: 'fp-1' });
  });

  it('thiếu file → service ném 400 (propagate)', async () => {
    serviceMock.enrollPortrait.mockRejectedValue(new BadRequestException());
    await expect(
      controller.enroll('u1', undefined, { user: {} }),
    ).rejects.toThrow(BadRequestException);
  });
});
