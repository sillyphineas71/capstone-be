/**
 * gate-access-report.service.spec.ts
 *
 * Unit tests cho GateAccessReportService (UC-127 T114-T116).
 * AC-004: MANAGER department scope out-of-bounds → 403
 * AC-001: createExportJob happy path
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GateAccessReportService } from '../services/gate-access-report.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { DashboardOverviewConfigService } from '../../analytics/services/dashboard-overview-config.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { BackgroundJobType } from '../../administration/entities/background-job.entity.js';
import {
  REPORT_EXPORT_QUEUE_NAME,
  GATE_ACCESS_EXPORT_JOB_NAME,
} from '../constants/report-export-job.constants.js';

describe('GateAccessReportService', () => {
  let service: GateAccessReportService;

  const mockAuthzRepo = { getEffectiveRolesAndPermissions: jest.fn() };
  const mockBackgroundJobsService = { createQueuedJob: jest.fn() };
  const mockQueueService = { addJob: jest.fn() };
  const mockDashboardConfigService = { getMaxRangeDays: jest.fn() };
  const mockAuditLogsService = { logAction: jest.fn() };
  const mockDataSource = { query: jest.fn() };

  const adminUser = { userId: 'user-admin', email: 'admin@test.com' };
  const managerUser = { userId: 'user-mgr', email: 'mgr@test.com' };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
    mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['SYSTEM_ADMIN'],
      permissions: ['report.gate_access.export'],
    });
    mockBackgroundJobsService.createQueuedJob.mockResolvedValue({
      id: 'job-123',
    });
    mockQueueService.addJob.mockResolvedValue('bull-job-1');
    mockAuditLogsService.logAction.mockResolvedValue(undefined);
    mockDataSource.query.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GateAccessReportService,
        { provide: AuthzReadRepository, useValue: mockAuthzRepo },
        { provide: BackgroundJobsService, useValue: mockBackgroundJobsService },
        { provide: QueueService, useValue: mockQueueService },
        {
          provide: DashboardOverviewConfigService,
          useValue: mockDashboardConfigService,
        },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<GateAccessReportService>(GateAccessReportService);
  });

  describe('validation', () => {
    it('rejects missing from/to', async () => {
      await expect(
        service.createExportJob(adminUser, {
          from: '',
          to: '',
          format: 'pdf',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects from > to', async () => {
      await expect(
        service.createExportJob(adminUser, {
          from: '2026-07-31',
          to: '2026-07-01',
          format: 'pdf',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects range exceeding maxRangeDays', async () => {
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(10);
      await expect(
        service.createExportJob(adminUser, {
          from: '2026-01-01',
          to: '2026-07-31',
          format: 'pdf',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('AC-004 — MANAGER scope', () => {
    it('rejects departmentId outside managed scope', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['report.gate_access.export'],
      });
      mockDataSource.query.mockResolvedValueOnce([{ id: 'dept-managed' }]);

      await expect(
        service.createExportJob(managerUser, {
          from: '2026-07-01',
          to: '2026-07-31',
          format: 'pdf',
          scope: { departmentId: 'dept-other' },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects userId outside managed department (CL-1)', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['report.gate_access.export'],
      });
      mockDataSource.query
        .mockResolvedValueOnce([{ id: 'dept-managed' }]) // managed departments
        .mockResolvedValueOnce([{ department_id: 'dept-other' }]); // target user's department

      await expect(
        service.createExportJob(managerUser, {
          from: '2026-07-01',
          to: '2026-07-31',
          format: 'pdf',
          scope: { userId: 'user-target' },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows userId within managed department', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['report.gate_access.export'],
      });
      mockDataSource.query
        .mockResolvedValueOnce([{ id: 'dept-managed' }])
        .mockResolvedValueOnce([{ department_id: 'dept-managed' }]);

      const result = await service.createExportJob(managerUser, {
        from: '2026-07-01',
        to: '2026-07-31',
        format: 'pdf',
        scope: { userId: 'user-target' },
      });

      expect(result.jobId).toBe('job-123');
    });
  });

  describe('AC-001 — happy path', () => {
    it('creates background job and enqueues BullMQ job', async () => {
      const result = await service.createExportJob(adminUser, {
        from: '2026-07-01',
        to: '2026-07-31',
        format: 'pdf',
      });

      expect(mockBackgroundJobsService.createQueuedJob).toHaveBeenCalledWith(
        expect.objectContaining({ jobType: BackgroundJobType.EXPORT_REPORT }),
      );
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        REPORT_EXPORT_QUEUE_NAME,
        GATE_ACCESS_EXPORT_JOB_NAME,
        expect.objectContaining({ backgroundJobId: 'job-123' }),
      );
      expect(result).toEqual({
        jobId: 'job-123',
        status: 'queued',
        delivery: 'download',
        outputFileId: null,
      });
    });
  });
});
