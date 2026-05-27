import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ResetAuditRepository } from './reset-audit.repository';

describe('ResetAuditRepository', () => {
  let repository: ResetAuditRepository;
  let dataSource: {
    query: jest.Mock;
  };

  beforeEach(async () => {
    dataSource = {
      query: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResetAuditRepository,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    repository = module.get<ResetAuditRepository>(ResetAuditRepository);
  });

  it('should insert audit log for OTP request', async () => {
    const params = {
      userId: 'user-uuid',
      email: 'user@example.com',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      requestId: 'req-1',
    };

    await repository.logOtpRequest(params);

    expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [
      params.userId,
      params.userId,
      params.ipAddress,
      params.userAgent,
      params.requestId,
      expect.any(String),
    ]);
  });

  it('should insert audit log for password reset success', async () => {
    const params = {
      userId: 'user-uuid',
      email: 'user@example.com',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      requestId: 'req-1',
    };

    await repository.logResetSuccess(params);

    expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [
      params.userId,
      params.userId,
      params.ipAddress,
      params.userAgent,
      params.requestId,
      expect.any(String),
    ]);
  });
});
