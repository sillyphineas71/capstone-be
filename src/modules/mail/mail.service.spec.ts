import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service.js';

/**
 * Unit test cho MailService.
 * Mock nodemailer — không gửi email thật (không kết nối Brevo SMTP).
 */

// Mock toàn bộ nodemailer module
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn(),
    verify: jest.fn(),
  }),
}));

import * as nodemailer from 'nodemailer';

describe('MailService', () => {
  let service: MailService;
  let mockTransporter: { sendMail: jest.Mock; verify: jest.Mock };

  const mockConfigEnabled = (mailEnabled: boolean) => ({
    get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
      const config: Record<string, unknown> = {
        MAIL_ENABLED: mailEnabled,
        MAIL_HOST: 'smtp.test.com',
        MAIL_PORT: 587,
        MAIL_SECURE: false,
        MAIL_USER: 'test@test.com',
        MAIL_PASS: 'testpassword',
        MAIL_FROM: 'noreply@test.com',
        MAIL_FROM_NAME: 'Test System',
        MAIL_TIMEOUT_MS: 5000,
      };
      return config[key] ?? defaultValue;
    }),
  });

  describe('when MAIL_ENABLED=true', () => {
    beforeEach(async () => {
      jest.clearAllMocks();

      mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: 'test-msg-id-123' }),
        verify: jest.fn().mockResolvedValue(true),
      };

      (nodemailer.createTransport as jest.Mock).mockReturnValue(
        mockTransporter,
      );

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: ConfigService, useValue: mockConfigEnabled(true) },
        ],
      }).compile();

      service = module.get<MailService>(MailService);
      service.onModuleInit(); // kích hoạt tạo transporter
    });

    it('should initialize transporter when MAIL_ENABLED=true', () => {
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.test.com',
          port: 587,
          secure: false,
        }),
      );
    });

    it('should send email and return success', async () => {
      const result = await service.sendMail({
        to: 'user@test.com',
        subject: 'Test Subject',
        text: 'Hello',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('test-msg-id-123');
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@test.com',
          subject: 'Test Subject',
          from: expect.stringContaining('noreply@test.com'),
        }),
      );
    });

    it('should return failure on SMTP error without throwing', async () => {
      mockTransporter.sendMail.mockRejectedValue(
        new Error('Connection refused'),
      );

      const result = await service.sendMail({
        to: 'user@test.com',
        subject: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('verifyConnection should return true on success', async () => {
      mockTransporter.verify.mockResolvedValue(true);
      const connected = await service.verifyConnection();
      expect(connected).toBe(true);
    });

    it('verifyConnection should return false on error', async () => {
      mockTransporter.verify.mockRejectedValue(new Error('Auth failed'));
      const connected = await service.verifyConnection();
      expect(connected).toBe(false);
    });

    it('should NOT log MAIL_PASS or MAIL_USER in error messages', async () => {
      mockTransporter.sendMail.mockRejectedValue(new Error('Some error'));
      const loggerErrorSpy = jest.spyOn(
        (service as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      );

      await service.sendMail({ to: 'x@x.com', subject: 'Test' });

      const errorCalls = loggerErrorSpy.mock.calls.map((args) =>
        String(args[0]),
      );
      for (const call of errorCalls) {
        expect(call).not.toContain('testpassword');
        expect(call).not.toContain('test@test.com');
      }
    });
  });

  describe('when MAIL_ENABLED=false', () => {
    beforeEach(async () => {
      jest.clearAllMocks();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: ConfigService, useValue: mockConfigEnabled(false) },
        ],
      }).compile();

      service = module.get<MailService>(MailService);
      service.onModuleInit();
    });

    it('should NOT create transporter when MAIL_ENABLED=false', () => {
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it('should skip sending and return success=false', async () => {
      const result = await service.sendMail({
        to: 'user@test.com',
        subject: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('MAIL_ENABLED=false');
    });

    it('verifyConnection should return false', async () => {
      const connected = await service.verifyConnection();
      expect(connected).toBe(false);
    });
  });
});
