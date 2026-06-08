import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthEmailService } from './auth-email.service';

describe('AuthEmailService', () => {
  let service: AuthEmailService;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthEmailService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<AuthEmailService>(AuthEmailService);
  });

  it('should successfully "send" OTP email', async () => {
    const email = 'user@example.com';
    const otp = '123456';

    await expect(service.sendOtp(email, otp)).resolves.toBeUndefined();
  });

  it('should throw InternalServerErrorException with AUTH_EMAIL_DISPATCH_FAILED when SMTP dispatch fails', async () => {
    const email = 'user@error.com';
    const otp = '123456';

    await expect(service.sendOtp(email, otp)).rejects.toThrow(
      InternalServerErrorException,
    );
    await expect(service.sendOtp(email, otp)).rejects.toThrow(
      'AUTH_EMAIL_DISPATCH_FAILED',
    );
  });
});
