import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  AuditLogsService,
  LogActionDto,
  LogEntityChangeDto,
} from './audit-logs.service.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../entities/audit-log.entity.js';

describe('AuditLogsService', () => {
  let service: AuditLogsService;

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockConfigService = (enabled: boolean, failSafe: boolean) => ({
    get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
      const config: Record<string, unknown> = {
        AUDIT_LOG_ENABLED: enabled,
        AUDIT_LOG_FAIL_SAFE: failSafe,
      };
      return config[key] ?? defaultValue;
    }),
  });

  const buildModule = async (
    enabled: boolean,
    failSafe: boolean,
  ): Promise<TestingModule> => {
    return Test.createTestingModule({
      providers: [
        AuditLogsService,
        { provide: getRepositoryToken(AuditLogEntity), useValue: mockRepo },
        {
          provide: ConfigService,
          useValue: mockConfigService(enabled, failSafe),
        },
      ],
    }).compile();
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when AUDIT_LOG_ENABLED=true', () => {
    beforeEach(async () => {
      const module = await buildModule(true, true);
      service = module.get<AuditLogsService>(AuditLogsService);
    });

    describe('logAction()', () => {
      it('should create and save audit log entry', async () => {
        const dto: LogActionDto = {
          userId: 'user-uuid',
          actionType: 'CREATE_MEETING',
          entityType: 'meeting',
          entityId: 'meeting-uuid',
          ipAddress: '127.0.0.1',
        };

        const mockEntry = { ...dto };
        mockRepo.create.mockReturnValue(mockEntry);
        mockRepo.save.mockResolvedValue(mockEntry);

        await service.logAction(dto);

        expect(mockRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user-uuid',
            actionType: 'CREATE_MEETING',
            entityType: 'meeting',
            severity: AuditLogSeverity.INFO,
          }),
        );
        expect(mockRepo.save).toHaveBeenCalled();
      });
    });

    describe('logSecurityEvent()', () => {
      it('should log with WARNING severity by default', async () => {
        mockRepo.create.mockReturnValue({});
        mockRepo.save.mockResolvedValue({});

        await service.logSecurityEvent({
          userId: 'user-uuid',
          actionType: 'LOGIN_SUCCESS',
          entityType: 'auth',
        });

        expect(mockRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: AuditLogSeverity.WARNING,
          }),
        );
      });
    });

    describe('logEntityChange()', () => {
      it('should log old and new values', async () => {
        mockRepo.create.mockReturnValue({});
        mockRepo.save.mockResolvedValue({});

        const dto: LogEntityChangeDto = {
          userId: 'user-uuid',
          actionType: 'UPDATE_ROOM',
          entityType: 'room',
          entityId: 'room-uuid',
          oldValueJson: { name: 'Old Room' },
          newValueJson: { name: 'New Room' },
        };

        await service.logEntityChange(dto);

        expect(mockRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            oldValueJson: { name: 'Old Room' },
            newValueJson: { name: 'New Room' },
          }),
        );
      });
    });
  });

  describe('when AUDIT_LOG_ENABLED=false', () => {
    beforeEach(async () => {
      const module = await buildModule(false, true);
      service = module.get<AuditLogsService>(AuditLogsService);
    });

    it('should skip all log operations', async () => {
      await service.logAction({ actionType: 'TEST', entityType: 'test' });
      await service.logSecurityEvent({ actionType: 'TEST' });
      await service.logEntityChange({ actionType: 'TEST', entityType: 'test' });

      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('when AUDIT_LOG_FAIL_SAFE=true', () => {
    beforeEach(async () => {
      const module = await buildModule(true, true);
      service = module.get<AuditLogsService>(AuditLogsService);
    });

    it('should NOT throw when save fails', async () => {
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.logAction({ actionType: 'TEST', entityType: 'test' }),
      ).resolves.not.toThrow();
    });
  });

  describe('when AUDIT_LOG_FAIL_SAFE=false', () => {
    beforeEach(async () => {
      const module = await buildModule(true, false);
      service = module.get<AuditLogsService>(AuditLogsService);
    });

    it('should throw when save fails', async () => {
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.logAction({ actionType: 'TEST', entityType: 'test' }),
      ).rejects.toThrow('DB connection lost');
    });
  });
});
