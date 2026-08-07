import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { GuestAccessController } from './guest-access.controller';
import { GuestOtpService } from '../services/guest-otp.service';

describe('GuestAccessController', () => {
  let controller: GuestAccessController;
  let service: {
    getInviteInfo: jest.Mock;
    requestOtp: jest.Mock;
    verifyOtp: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getInviteInfo: jest.fn(),
      requestOtp: jest.fn(),
      verifyOtp: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GuestAccessController],
      providers: [{ provide: GuestOtpService, useValue: service }],
    }).compile();

    controller = module.get(GuestAccessController);
  });

  describe('getInviteInfo', () => {
    it('should return response shape {success, message, data}', async () => {
      service.getInviteInfo.mockResolvedValue({
        meetingTitle: 'Weekly Sync',
        startTime: new Date('2026-08-10T09:00:00Z'),
        endTime: new Date('2026-08-10T10:00:00Z'),
        hostName: 'Host Nguyen',
        maskedEmail: 'gu***@partner.com',
        verificationMode: 'otp',
      });

      const result = await controller.getInviteInfo('ep-1.secret');

      expect(result.success).toBe(true);
      expect(result.data.meetingTitle).toBe('Weekly Sync');
      expect(result.data.maskedEmail).toBe('gu***@partner.com');
      expect(typeof result.data.startTime).toBe('string');
    });

    it('should propagate errors from the service (e.g. invalid token)', async () => {
      service.getInviteInfo.mockRejectedValue(new BadRequestException());
      await expect(controller.getInviteInfo('bad')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('requestOtp', () => {
    it('should call service and return a generic success message (no secret leaked)', async () => {
      const result = await controller.requestOtp('ep-1.secret');
      expect(service.requestOtp).toHaveBeenCalledWith('ep-1.secret');
      expect(result.success).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/otp|secret/i);
    });
  });

  describe('verifyOtp', () => {
    it('should return the guest token from the service', async () => {
      service.verifyOtp.mockResolvedValue({
        guestToken: 'guest-jwt',
        lobbyRequired: true,
        meetingId: 'meeting-1',
      });

      const result = await controller.verifyOtp('ep-1.secret', {
        otp: '123456',
      });

      expect(service.verifyOtp).toHaveBeenCalledWith('ep-1.secret', '123456');
      expect(result.data.guestToken).toBe('guest-jwt');
      expect(result.data.lobbyRequired).toBe(true);
    });
  });
});
