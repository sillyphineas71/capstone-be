/**
 * vehicle-report.service.spec.ts
 *
 * Unit tests cho VehicleReportService (UC-128 T215, T216).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { VehicleReportService } from '../services/vehicle-report.service.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { DashboardOverviewConfigService } from '../../analytics/services/dashboard-overview-config.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { BackgroundJobType } from '../../administration/entities/background-job.entity.js';
import {
  REPORT_EXPORT_QUEUE_NAME,
  VEHICLE_EXPORT_JOB_NAME,
} from '../constants/report-export-job.constants.js';

describe('VehicleReportService', () => {
  let service: VehicleReportService;

  const mockBackgroundJobsService = { createQueuedJob: jest.fn() };
  const mockQueueService = { addJob: jest.fn() };
  const mockDashboardConfigService = { getMaxRangeDays: jest.fn() };
  const mockAuditLogsService = { logAction: jest.fn() };

  const user = { userId: 'user-1', email: 'user@test.com' };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
    mockBackgroundJobsService.createQueuedJob.mockResolvedValue({
      id: 'job-123',
    });
    mockQueueService.addJob.mockResolvedValue('bull-job-1');
    mockAuditLogsService.logAction.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehicleReportService,
        { provide: BackgroundJobsService, useValue: mockBackgroundJobsService },
        { provide: QueueService, useValue: mockQueueService },
        {
          provide: DashboardOverviewConfigService,
          useValue: mockDashboardConfigService,
        },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<VehicleReportService>(VehicleReportService);
  });

  describe('validation', () => {
    it('rejects missing from/to', async () => {
      await expect(
        service.createExportJob(user, {
          from: '',
          to: '',
          format: 'pdf',
          content: 'registrations',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects from > to', async () => {
      await expect(
        service.createExportJob(user, {
          from: '2026-07-31',
          to: '2026-07-01',
          format: 'pdf',
          content: 'registrations',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects range exceeding maxRangeDays', async () => {
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(5);
      await expect(
        service.createExportJob(user, {
          from: '2026-01-01',
          to: '2026-07-31',
          format: 'pdf',
          content: 'both',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('happy path — no department scope enforcement (§2.2 spec)', () => {
    it('creates background job and enqueues BullMQ job for content=both', async () => {
      const result = await service.createExportJob(user, {
        from: '2026-07-01',
        to: '2026-07-31',
        format: 'xlsx',
        content: 'both',
        filters: { vehicleType: 'car', zoneId: 'zone-1' },
      });

      expect(mockBackgroundJobsService.createQueuedJob).toHaveBeenCalledWith(
        expect.objectContaining({ jobType: BackgroundJobType.EXPORT_REPORT }),
      );
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        REPORT_EXPORT_QUEUE_NAME,
        VEHICLE_EXPORT_JOB_NAME,
        expect.objectContaining({
          backgroundJobId: 'job-123',
          content: 'both',
          filters: { vehicleType: 'car', zoneId: 'zone-1' },
        }),
      );
      expect(result).toEqual({
        jobId: 'job-123',
        status: 'queued',
        delivery: 'download',
        outputFileId: null,
      });
    });

    it('defaults filters to null when not provided', async () => {
      await service.createExportJob(user, {
        from: '2026-07-01',
        to: '2026-07-31',
        format: 'pdf',
        content: 'registrations',
      });

      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        REPORT_EXPORT_QUEUE_NAME,
        VEHICLE_EXPORT_JOB_NAME,
        expect.objectContaining({
          filters: { vehicleType: null, zoneId: null },
        }),
      );
    });
  });
});
