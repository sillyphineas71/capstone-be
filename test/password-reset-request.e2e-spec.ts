jest.mock('@nestjs/typeorm', () => ({
  TypeOrmModule: {
    forRoot: () => ({
      module: class {},
      providers: [],
      exports: [],
    }),
    forFeature: () => ({
      module: class {},
      providers: [],
      exports: [],
    }),
  },
}));

jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return {
    ...actual,
    DataSource: class {
      initialize = jest.fn().mockResolvedValue(this);
      destroy = jest.fn().mockResolvedValue(undefined);
      query = jest.fn().mockResolvedValue([]);
      transaction = jest
        .fn()
        .mockImplementation((cb) => cb({ query: jest.fn() }));
    },
  };
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { UsersResetRepository } from '../src/modules/auth/repositories/users-reset.repository';
import { PasswordResetCacheService } from '../src/modules/auth/services/password-reset-cache.service';
import { AuthEmailService } from '../src/modules/auth/services/auth-email.service';

describe('Password Reset Request (e2e)', () => {
  let app: INestApplication<App>;
  let mockUsersRepository: any;
  let mockCacheService: any;
  let mockEmailService: any;

  beforeEach(async () => {
    mockUsersRepository = {
      findByEmailForReset: jest.fn(),
    };

    mockCacheService = {
      isBlocked: jest.fn().mockResolvedValue(false),
      incrementLimitCounter: jest.fn().mockResolvedValue(1),
      setOtpSession: jest.fn().mockResolvedValue(undefined),
    };

    mockEmailService = {
      sendOtp: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UsersResetRepository)
      .useValue(mockUsersRepository)
      .overrideProvider(PasswordResetCacheService)
      .useValue(mockCacheService)
      .overrideProvider(AuthEmailService)
      .useValue(mockEmailService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sends OTP successfully with active email', async () => {
    mockUsersRepository.findByEmailForReset.mockResolvedValue({
      id: 'user-id',
      email: 'active@example.com',
      passwordHash: 'hash',
      accountStatus: 'active',
      employmentStatus: 'active',
      deletedAt: null,
    });

    const response = await request(app.getHttpServer())
      .post('/auth/password-reset/request')
      .send({ email: 'active@example.com' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('Mã xác thực đã được gửi');
  });

  it('returns HTTP 400 with AUTH_ACCOUNT_RESTRICTED for restricted or inactive email', async () => {
    mockUsersRepository.findByEmailForReset.mockResolvedValue({
      id: 'user-id',
      email: 'restricted@example.com',
      passwordHash: 'hash',
      accountStatus: 'locked', // locked
      employmentStatus: 'active',
      deletedAt: null,
    });

    const response = await request(app.getHttpServer())
      .post('/auth/password-reset/request')
      .send({ email: 'restricted@example.com' })
      .expect(400);

    expect(response.body.message).toContain(
      'Email không tồn tại hoặc tài khoản đã bị khóa',
    );
    expect(response.body.error.code).toBe('AUTH_ACCOUNT_RESTRICTED');
  });

  it('returns HTTP 429 when rate limit exceeded', async () => {
    mockCacheService.isBlocked.mockResolvedValue(true);

    const response = await request(app.getHttpServer())
      .post('/auth/password-reset/request')
      .send({ email: 'spam@example.com' })
      .expect(429);

    expect(response.body.message).toContain('Yêu cầu quá nhiều lần');
    expect(response.body.error.code).toBe('AUTH_TOO_MANY_ATTEMPTS');
  });
});
