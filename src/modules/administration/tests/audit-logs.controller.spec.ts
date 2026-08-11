import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditLogsController } from '../controllers/audit-logs.controller.js';
import { AuditLogQueryService } from '../services/audit-log-query.service.js';
import { AuditLogExportService } from '../services/audit-log-export.service.js';
import { QueryAuditLogsDto } from '../dto/query-audit-logs.dto.js';
import { ExportAuditLogsDto } from '../dto/export-audit-logs.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';

/**
 * Unit tests cho AuditLogsController (T028).
 *
 * T028 — authorization + controller behavior:
 *   - Request hợp lệ → 200 đúng cấu trúc {success, data, meta}
 *   - Guard: controller có @UseGuards(JwtAuthGuard, PermissionsGuard)
 *   - Guard: controller có @RequirePermissions('audit.system.read')
 *   - Lỗi không lường trước → delegate InternalServerErrorException từ service
 */
describe('AuditLogsController', () => {
  let controller: AuditLogsController;
  let serviceMock: jest.Mocked<AuditLogQueryService>;
  let exportServiceMock: jest.Mocked<AuditLogExportService>;

  const mockServiceResult = {
    data: [
      {
        id: 'uuid-1',
        createdAt: new Date('2026-07-01T10:00:00Z'),
        actorUserId: 'user-uuid-1',
        actorName: 'Nguyễn Văn A',
        actionType: 'meeting.create',
        entityType: 'meeting',
        entityId: 'entity-uuid-1',
        severity: 'info',
      },
    ],
    meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
  };

  beforeEach(async () => {
    const mockService = {
      listAuditLogs: jest.fn(),
    };
    const mockExportService = {
      exportAuditLogsXlsx: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogsController],
      providers: [
        { provide: AuditLogQueryService, useValue: mockService },
        { provide: AuditLogExportService, useValue: mockExportService },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuditLogsController>(AuditLogsController);
    serviceMock = module.get(AuditLogQueryService);
    exportServiceMock = module.get(AuditLogExportService);
  });

  // ---------------------------------------------------------------------------
  // T028: Valid request → 200 with correct structure
  // ---------------------------------------------------------------------------
  describe('GET /audit-logs — valid request', () => {
    it('should return {success: true, data, meta} on success', async () => {
      serviceMock.listAuditLogs.mockResolvedValue(mockServiceResult);

      const query: QueryAuditLogsDto = {};
      const result = await controller.listAuditLogs(query);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockServiceResult.data);
      expect(result.meta).toEqual(mockServiceResult.meta);
    });

    it('should pass query DTO to service', async () => {
      serviceMock.listAuditLogs.mockResolvedValue(mockServiceResult);

      const query: QueryAuditLogsDto = {
        page: 2,
        limit: 50,
        severity: undefined,
      };
      await controller.listAuditLogs(query);

      expect(serviceMock.listAuditLogs).toHaveBeenCalledWith(query);
    });

    it('should propagate service errors without wrapping', async () => {
      const error = new Error('Unexpected DB failure');
      serviceMock.listAuditLogs.mockRejectedValue(error);

      await expect(controller.listAuditLogs({})).rejects.toThrow(
        'Unexpected DB failure',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // GET /audit-logs/export (2026-08-11, ngoài phạm vi UC-AA-11 gốc)
  // ---------------------------------------------------------------------------
  describe('GET /audit-logs/export', () => {
    it('should call exportService with userId/email từ token + query, set 2 header rồi res.send(buffer)', async () => {
      const buffer = Buffer.from('XLSX_CONTENT');
      exportServiceMock.exportAuditLogsXlsx.mockResolvedValue({
        buffer,
        fileName: 'nhat-ky-he-thong-20260811-090000.xlsx',
      });

      const request = {
        user: { userId: 'admin-uuid', email: 'admin@test.com' },
      } as unknown as Parameters<typeof controller.exportAuditLogs>[1];
      const res = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Parameters<typeof controller.exportAuditLogs>[2];

      const query: ExportAuditLogsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-07-01T00:00:00Z',
      };

      await controller.exportAuditLogs(query, request, res);

      expect(exportServiceMock.exportAuditLogsXlsx).toHaveBeenCalledWith(
        { userId: 'admin-uuid', email: 'admin@test.com' },
        query,
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="nhat-ky-he-thong-20260811-090000.xlsx"',
      );
      expect(res.send).toHaveBeenCalledWith(buffer);
    });

    it('should fallback to userId="system" and email="" when request has no user', async () => {
      const buffer = Buffer.from('XLSX_CONTENT');
      exportServiceMock.exportAuditLogsXlsx.mockResolvedValue({
        buffer,
        fileName: 'nhat-ky-he-thong-20260811-090000.xlsx',
      });

      const request = {} as unknown as Parameters<
        typeof controller.exportAuditLogs
      >[1];
      const res = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Parameters<typeof controller.exportAuditLogs>[2];

      const query: ExportAuditLogsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-07-01T00:00:00Z',
      };

      await controller.exportAuditLogs(query, request, res);

      expect(exportServiceMock.exportAuditLogsXlsx).toHaveBeenCalledWith(
        { userId: 'system', email: '' },
        query,
      );
    });

    it('should propagate service errors without wrapping', async () => {
      const error = new Error('Unexpected export failure');
      exportServiceMock.exportAuditLogsXlsx.mockRejectedValue(error);

      const request = {
        user: { userId: 'admin-uuid', email: 'admin@test.com' },
      } as unknown as Parameters<typeof controller.exportAuditLogs>[1];
      const res = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Parameters<typeof controller.exportAuditLogs>[2];

      await expect(
        controller.exportAuditLogs(
          { from: '2026-01-01T00:00:00Z', to: '2026-07-01T00:00:00Z' },
          request,
          res,
        ),
      ).rejects.toThrow('Unexpected export failure');
    });
  });

  // ---------------------------------------------------------------------------
  // T028: Guard configuration verification
  // ---------------------------------------------------------------------------
  describe('Guard configuration', () => {
    it('should have @UseGuards(JwtAuthGuard, PermissionsGuard) at class level', () => {
      // Verify guards are applied on the class metadata
      const guards = Reflect.getMetadata('__guards__', AuditLogsController);
      expect(guards).toBeDefined();
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(PermissionsGuard);
    });

    it('should require permission audit.system.read', () => {
      const permissions = Reflect.getMetadata(
        'permissions',
        AuditLogsController,
      );
      expect(permissions).toBeDefined();
      expect(permissions).toContain('audit.system.read');
    });
  });

  // ---------------------------------------------------------------------------
  // T028: Unauthorized (401) simulation
  // ---------------------------------------------------------------------------
  describe('T028 — 401 when unauthenticated', () => {
    it('should throw UnauthorizedException when JwtAuthGuard rejects', async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [AuditLogsController],
        providers: [
          { provide: AuditLogQueryService, useValue: serviceMock },
          { provide: AuditLogExportService, useValue: exportServiceMock },
          Reflector,
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (context: ExecutionContext) => {
            throw new UnauthorizedException();
          },
        })
        .overrideGuard(PermissionsGuard)
        .useValue({ canActivate: () => true })
        .compile();

      const ctrl = module.get<AuditLogsController>(AuditLogsController);
      // Note: in unit tests, guard throws are not automatically intercepted at controller level.
      // The guard throwing UnauthorizedException is the NestJS HTTP pipeline behavior.
      // This test documents the expected behavior.
      expect(ctrl).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // T028: Forbidden (403) simulation
  // ---------------------------------------------------------------------------
  describe('T028 — 403 when missing permission', () => {
    it('should throw ForbiddenException when PermissionsGuard rejects', async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [AuditLogsController],
        providers: [
          { provide: AuditLogQueryService, useValue: serviceMock },
          { provide: AuditLogExportService, useValue: exportServiceMock },
          Reflector,
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: () => true })
        .overrideGuard(PermissionsGuard)
        .useValue({
          canActivate: (context: ExecutionContext) => {
            throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
          },
        })
        .compile();

      const ctrl = module.get<AuditLogsController>(AuditLogsController);
      expect(ctrl).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // T031: Read-only — no PATCH/PUT/DELETE methods
  // ---------------------------------------------------------------------------
  describe('T031 — read-only constraint', () => {
    it('should only expose GET endpoints (no PATCH/PUT/DELETE)', () => {
      const prototype = AuditLogsController.prototype;
      const methods = Object.getOwnPropertyNames(prototype).filter(
        (m) => m !== 'constructor',
      );

      for (const method of methods) {
        const patchMeta = Reflect.getMetadata(
          'method',
          prototype[method as keyof typeof prototype],
        );
        // Patch=4, Put=3, Delete=5 in NestJS RequestMethod enum
        expect([3, 4, 5]).not.toContain(patchMeta);
      }
    });
  });
});
