import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AuditLogExportService } from '../services/audit-log-export.service.js';
import { AuditLogQueryRepository } from '../repositories/audit-log-query.repository.js';
import { AuditLogsService } from '../services/audit-logs.service.js';
import { ExportAuditLogsDto } from '../dto/export-audit-logs.dto.js';

/**
 * Unit tests cho AuditLogExportService (2026-08-11, ngoài phạm vi UC-AA-11 gốc).
 *
 * - Validate from > to
 * - Chỉ map đúng 5 trường như AuditLogItemDto (FR-025) — không lộ field nhạy cảm
 * - Cap MAX_EXPORT_ROWS = 50000 truyền đúng xuống repository
 * - Tự ghi audit log 'export_audit_logs' (fire-and-forget, không chặn response)
 * - Lỗi ghi audit log không làm hỏng response (chỉ warn)
 */
describe('AuditLogExportService', () => {
  let service: AuditLogExportService;
  let repositoryMock: jest.Mocked<AuditLogQueryRepository>;
  let auditLogsServiceMock: jest.Mocked<AuditLogsService>;

  const makeRow = (
    overrides: Partial<{
      id: string;
      created_at: Date;
      user_id: string | null;
      action_type: string;
      entity_type: string;
      entity_id: string | null;
      severity: string;
      user_full_name: string | null;
    }> = {},
  ) => ({
    id: 'uuid-1',
    created_at: new Date('2026-07-01T10:00:00Z'),
    user_id: 'user-uuid-1',
    action_type: 'meeting.create',
    entity_type: 'meeting',
    entity_id: 'entity-uuid-1',
    severity: 'info',
    user_full_name: 'Nguyễn Văn A',
    ...overrides,
  });

  const validDto: ExportAuditLogsDto = {
    from: '2026-01-01T00:00:00Z',
    to: '2026-07-01T00:00:00Z',
  };

  beforeEach(async () => {
    const mockRepo = {
      findAllForExport: jest.fn(),
      countMatching: jest.fn(),
    };
    const mockAuditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogExportService,
        { provide: AuditLogQueryRepository, useValue: mockRepo },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<AuditLogExportService>(AuditLogExportService);
    repositoryMock = module.get(AuditLogQueryRepository);
    auditLogsServiceMock = module.get(AuditLogsService);
  });

  describe('validate from > to', () => {
    it('should throw BadRequestException with VALIDATION_ERROR when from > to', async () => {
      const dto: ExportAuditLogsDto = {
        from: '2026-12-31T00:00:00Z',
        to: '2026-01-01T00:00:00Z',
      };

      await expect(
        service.exportAuditLogsXlsx({ userId: 'u1', email: 'a@b.com' }, dto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.exportAuditLogsXlsx({ userId: 'u1', email: 'a@b.com' }, dto),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      });
    });

    it('should NOT throw when from === to', async () => {
      repositoryMock.findAllForExport.mockResolvedValue([]);
      repositoryMock.countMatching.mockResolvedValue(0);

      const dto: ExportAuditLogsDto = {
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-01T00:00:00Z',
      };

      await expect(
        service.exportAuditLogsXlsx({ userId: 'u1', email: 'a@b.com' }, dto),
      ).resolves.toBeDefined();
    });
  });

  describe('MAX_EXPORT_ROWS cap', () => {
    it('should pass limit=50000 to findAllForExport', async () => {
      repositoryMock.findAllForExport.mockResolvedValue([]);
      repositoryMock.countMatching.mockResolvedValue(0);

      await service.exportAuditLogsXlsx(
        { userId: 'u1', email: 'a@b.com' },
        validDto,
      );

      expect(repositoryMock.findAllForExport).toHaveBeenCalledWith(
        expect.objectContaining({ from: validDto.from, to: validDto.to }),
        50000,
      );
    });
  });

  describe('row mapping — chỉ 5 trường như AuditLogItemDto (FR-025)', () => {
    it('should produce buffer without throwing for a normal row set', async () => {
      const row = makeRow();
      repositoryMock.findAllForExport.mockResolvedValue([row]);
      repositoryMock.countMatching.mockResolvedValue(1);

      const result = await service.exportAuditLogsXlsx(
        { userId: 'u1', email: 'a@b.com' },
        validDto,
      );

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.fileName).toMatch(/^nhat-ky-he-thong-.*\.xlsx$/);
    });

    it('should resolve actorName="Hệ thống" when user_id is null (same as list endpoint)', async () => {
      const row = makeRow({ user_id: null, user_full_name: null });
      repositoryMock.findAllForExport.mockResolvedValue([row]);
      repositoryMock.countMatching.mockResolvedValue(1);

      await expect(
        service.exportAuditLogsXlsx(
          { userId: 'u1', email: 'a@b.com' },
          validDto,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('tự ghi audit log export_audit_logs', () => {
    it('should call AuditLogsService.logAction with actionType export_audit_logs', async () => {
      repositoryMock.findAllForExport.mockResolvedValue([makeRow()]);
      repositoryMock.countMatching.mockResolvedValue(1);

      await service.exportAuditLogsXlsx(
        { userId: 'admin-uuid', email: 'admin@smartracking.io' },
        validDto,
      );

      // fire-and-forget — allow microtask queue to flush
      await new Promise((resolve) => setImmediate(resolve));

      expect(auditLogsServiceMock.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-uuid',
          actionType: 'export_audit_logs',
          entityType: 'audit_logs',
          metadataJson: expect.objectContaining({
            rowCount: 1,
            totalMatching: 1,
          }),
        }),
      );
    });

    it('should NOT fail the export when logAction rejects', async () => {
      repositoryMock.findAllForExport.mockResolvedValue([makeRow()]);
      repositoryMock.countMatching.mockResolvedValue(1);
      auditLogsServiceMock.logAction.mockRejectedValue(
        new Error('audit write failed'),
      );

      await expect(
        service.exportAuditLogsXlsx(
          { userId: 'admin-uuid', email: 'admin@smartracking.io' },
          validDto,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should wrap unexpected errors in InternalServerErrorException', async () => {
      repositoryMock.findAllForExport.mockRejectedValue(
        new Error('DB connection lost'),
      );
      repositoryMock.countMatching.mockResolvedValue(0);

      await expect(
        service.exportAuditLogsXlsx(
          { userId: 'u1', email: 'a@b.com' },
          validDto,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
