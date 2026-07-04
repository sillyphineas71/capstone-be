/**
 * meeting-activity-report.service.spec.ts
 *
 * Unit tests cho MeetingActivityReportService (T031, T032).
 * Test: validation from/to, maxRangeDays, delivery, department scope, createExportJob.
 *
 * AC-004: from/to validation
 * AC-005: delivery validation
 * AC-006: format validation (handled by DTO class-validator)
 * AC-001: createExportJob happy path
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { MeetingActivityReportService } from '../services/meeting-activity-report.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { DashboardOverviewConfigService } from '../../analytics/services/dashboard-overview-config.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { BackgroundJobType } from '../../administration/entities/background-job.entity.js';
import {
  REPORT_EXPORT_QUEUE_NAME,
  MEETING_ACTIVITY_EXPORT_JOB_NAME,
} from '../constants/report-export-job.constants.js';

describe('MeetingActivityReportService', () => {
  let service: MeetingActivityReportService;

  const mockAuthzRepo = {
    getEffectiveRolesAndPermissions: jest.fn(),
  };
  const mockBackgroundJobsService = {
    createQueuedJob: jest.fn(),
  };
  const mockQueueService = {
    addJob: jest.fn(),
  };
  const mockDashboardConfigService = {
    getMaxRangeDays: jest.fn(),
  };
  const mockAuditLogsService = {
    logAction: jest.fn(),
  };
  const mockDataSource = {
    query: jest.fn(),
  };
  const mockConfigService = {
    get: jest.fn().mockReturnValue('true'),
  };

  const adminUser = { id: 'user-admin', email: 'admin@test.com', roles: ['SYSTEM_ADMIN'] };
  const managerUser = { id: 'user-mgr', email: 'mgr@test.com', roles: ['MANAGER'] };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
    mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['SYSTEM_ADMIN'],
      permissions: ['report.meeting_activity.export'],
    });
    mockBackgroundJobsService.createQueuedJob.mockResolvedValue({ id: 'job-123' });
    mockQueueService.addJob.mockResolvedValue('bull-job-1');
    mockAuditLogsService.logAction.mockResolvedValue(undefined);
    mockDataSource.query.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingActivityReportService,
        { provide: AuthzReadRepository, useValue: mockAuthzRepo },
        { provide: BackgroundJobsService, useValue: mockBackgroundJobsService },
        { provide: QueueService, useValue: mockQueueService },
        { provide: DashboardOverviewConfigService, useValue: mockDashboardConfigService },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: DataSource, useValue: mockDataSource },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MeetingActivityReportService>(MeetingActivityReportService);
  });

  // ─── T031: Validation tests ─────────────────────────────────────────────────

  describe('T031 — Validation', () => {
    it('throws VALIDATION_ERROR when from > to', async () => {
      await expect(
        service.createExportJob(adminUser, {
          from: '2026-07-10',
          to: '2026-07-01',
          format: 'pdf',
        }),
      ).rejects.toMatchObject({
        response: { error: { code: 'VALIDATION_ERROR' } },
      });
    });

    it('throws DATE_RANGE_TOO_LARGE when range exceeds maxRangeDays', async () => {
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(30);
      await expect(
        service.createExportJob(adminUser, {
          from: '2026-01-01',
          to: '2026-03-01',
          format: 'pdf',
        }),
      ).rejects.toMatchObject({
        response: { error: { code: 'DATE_RANGE_TOO_LARGE' } },
      });
    });

    it('throws VALIDATION_ERROR when delivery is not download', async () => {
      await expect(
        service.createExportJob(adminUser, {
          from: '2026-07-01',
          to: '2026-07-10',
          format: 'pdf',
          delivery: 'email',
        }),
      ).rejects.toMatchObject({
        response: { error: { code: 'VALIDATION_ERROR' } },
      });
    });

    it('accepts delivery=download', async () => {
      await expect(
        service.createExportJob(adminUser, {
          from: '2026-07-01',
          to: '2026-07-10',
          format: 'pdf',
          delivery: 'download',
        }),
      ).resolves.toMatchObject({ status: 'queued' });
    });

    it('accepts undefined delivery (defaults to download)', async () => {
      await expect(
        service.createExportJob(adminUser, {
          from: '2026-07-01',
          to: '2026-07-10',
          format: 'pdf',
        }),
      ).resolves.toMatchObject({ status: 'queued' });
    });
  });

  // ─── T031: Department scope tests ────────────────────────────────────────────

  describe('T031 — Department scope (MANAGER)', () => {
    beforeEach(() => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['report.meeting_activity.export'],
      });
    });

    it('throws DEPARTMENT_OUT_OF_SCOPE when MANAGER requests dept outside scope', async () => {
      // MANAGER only manages dept-AAA
      mockDataSource.query.mockResolvedValue([{ id: 'dept-AAA' }]);

      await expect(
        service.createExportJob(managerUser, {
          from: '2026-07-01',
          to: '2026-07-10',
          format: 'pdf',
          scope: { departmentId: 'dept-BBB' },
        }),
      ).rejects.toMatchObject({
        response: { error: { code: 'DEPARTMENT_OUT_OF_SCOPE' } },
      });
    });

    it('accepts when MANAGER requests dept within scope', async () => {
      mockDataSource.query.mockResolvedValue([{ id: 'dept-AAA' }]);

      await expect(
        service.createExportJob(managerUser, {
          from: '2026-07-01',
          to: '2026-07-10',
          format: 'pdf',
          scope: { departmentId: 'dept-AAA' },
        }),
      ).resolves.toMatchObject({ status: 'queued' });
    });

    it('ADMIN can request any departmentId', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['report.meeting_activity.export'],
      });

      await expect(
        service.createExportJob(adminUser, {
          from: '2026-07-01',
          to: '2026-07-10',
          format: 'pdf',
          scope: { departmentId: 'any-dept-id' },
        }),
      ).resolves.toMatchObject({ status: 'queued' });
    });
  });

  // ─── T032: createExportJob happy path ────────────────────────────────────────

  describe('T032 — createExportJob happy path (AC-001)', () => {
    it('calls BackgroundJobsService.createQueuedJob with EXPORT_REPORT jobType', async () => {
      await service.createExportJob(adminUser, {
        from: '2026-07-01',
        to: '2026-07-10',
        format: 'xlsx',
      });

      expect(mockBackgroundJobsService.createQueuedJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobType: BackgroundJobType.EXPORT_REPORT,
          requestedBy: adminUser.id,
        }),
      );
    });

    it('calls QueueService.addJob with correct queue and job names', async () => {
      await service.createExportJob(adminUser, {
        from: '2026-07-01',
        to: '2026-07-10',
        format: 'pdf',
      });

      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        REPORT_EXPORT_QUEUE_NAME,
        MEETING_ACTIVITY_EXPORT_JOB_NAME,
        expect.objectContaining({
          backgroundJobId: 'job-123',
          from: '2026-07-01',
          to: '2026-07-10',
          format: 'pdf',
          requestedByEmail: adminUser.email,
        }),
      );
    });

    it('returns 202 response with jobId, status queued, delivery download, outputFileId null', async () => {
      const result = await service.createExportJob(adminUser, {
        from: '2026-07-01',
        to: '2026-07-10',
        format: 'pdf',
      });

      expect(result).toEqual({
        jobId: 'job-123',
        status: 'queued',
        delivery: 'download',
        outputFileId: null,
      });
    });
  });
});
