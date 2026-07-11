import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoomUtilizationReportService } from '../services/room-utilization-report.service.js';
import { RoomUtilizationReportDataService } from '../services/room-utilization-report-data.service.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { DashboardOverviewConfigService } from '../../analytics/services/dashboard-overview-config.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { CreateRoomUtilizationExportDto } from '../dto/create-room-utilization-export.dto.js';

describe('RoomUtilizationReportService', () => {
  let service: RoomUtilizationReportService;

  const mockBackgroundJobsService = { createQueuedJob: jest.fn() };
  const mockQueueService = { addJob: jest.fn() };
  const mockDashboardConfigService = { getMaxRangeDays: jest.fn() };
  const mockAuditLogsService = { logAction: jest.fn() };
  const mockDataService = { hasAnyBookingInScope: jest.fn() };
  const mockConfigService = { get: jest.fn().mockReturnValue('true') };

  // Correct shape matching the real JwtAuthGuard contract: { userId, email } — NOT { id, roles }.
  const currentUser = { userId: 'user-admin', email: 'admin@test.com' };

  const validDto: CreateRoomUtilizationExportDto = {
    from: '2026-06-01',
    to: '2026-06-30',
    format: 'xlsx',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
    mockDataService.hasAnyBookingInScope.mockResolvedValue(true);
    mockBackgroundJobsService.createQueuedJob.mockResolvedValue({
      id: 'job-1',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomUtilizationReportService,
        { provide: BackgroundJobsService, useValue: mockBackgroundJobsService },
        { provide: QueueService, useValue: mockQueueService },
        {
          provide: DashboardOverviewConfigService,
          useValue: mockDashboardConfigService,
        },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        {
          provide: RoomUtilizationReportDataService,
          useValue: mockDataService,
        },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<RoomUtilizationReportService>(
      RoomUtilizationReportService,
    );
  });

  describe('AC-001: Happy path', () => {
    it('creates a queued job and enqueues it', async () => {
      const result = await service.createExportJob(currentUser, validDto);

      expect(result).toEqual({
        jobId: 'job-1',
        status: 'queued',
        delivery: 'download',
        outputFileId: null,
      });
      expect(mockBackgroundJobsService.createQueuedJob).toHaveBeenCalledWith(
        expect.objectContaining({ requestedBy: currentUser.userId }),
      );
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        'report-export',
        'export:room-utilization',
        expect.objectContaining({ backgroundJobId: 'job-1' }),
      );
    });
  });

  describe('AC-004: Empty data set (Exception E1)', () => {
    it('rejects with 422 EMPTY_DATA_SET and does not create a job', async () => {
      mockDataService.hasAnyBookingInScope.mockResolvedValue(false);

      await expect(
        service.createExportJob(currentUser, validDto),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mockBackgroundJobsService.createQueuedJob).not.toHaveBeenCalled();
    });
  });

  describe('Validation', () => {
    it('rejects when from is after to', async () => {
      const dto = { ...validDto, from: '2026-07-01', to: '2026-06-01' };
      await expect(service.createExportJob(currentUser, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when range exceeds max days', async () => {
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(10);
      const dto = { ...validDto, from: '2026-01-01', to: '2026-06-30' };
      await expect(service.createExportJob(currentUser, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects delivery values other than "download"', async () => {
      const dto = { ...validDto, delivery: 'email' };
      await expect(service.createExportJob(currentUser, dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
