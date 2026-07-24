/**
 * vehicle-report-worker.processor.spec.ts
 *
 * Unit tests cho VehicleReportWorkerProcessor (UC-128 T221).
 * Verify: content dispatch (registrations/traffic_stats/both), happy path,
 * empty data still completes (§0.1), error handling.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VehicleReportWorkerProcessor } from '../processors/vehicle-report-worker.processor.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { VehicleReportDataService } from '../services/vehicle-report-data.service.js';
import { MediaFileEntity } from '../../recording/entities/media-file.entity.js';
import { StorageService } from '../../storage/storage.service.js';

const mockRenderPdf = jest.fn().mockResolvedValue(Buffer.from('PDF_CONTENT'));
const mockRenderXlsx = jest.fn().mockResolvedValue(Buffer.from('XLSX_CONTENT'));

jest.mock('../renderers/vehicle-pdf-renderer.js', () => ({
  renderVehiclePdf: (...args: unknown[]) => mockRenderPdf(...args),
}));
jest.mock('../renderers/vehicle-xlsx-renderer.js', () => ({
  renderVehicleXlsx: (...args: unknown[]) => mockRenderXlsx(...args),
}));

describe('VehicleReportWorkerProcessor', () => {
  let processor: VehicleReportWorkerProcessor;

  const mockBackgroundJobsService = {
    markRunning: jest.fn().mockResolvedValue(undefined),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };

  const mockDataService = {
    listRegistrationsForExport: jest.fn().mockResolvedValue([]),
    getTrafficStats: jest.fn().mockResolvedValue({
      summary: {
        total_events: 0,
        total_matched: 0,
        total_unmatched: 0,
        total_enter: 0,
        total_leave: 0,
        total_seen: 0,
        unique_vehicles: 0,
      },
      series: [],
    }),
  };

  const mockMediaFileRepo = {
    create: jest.fn().mockReturnValue({ id: 'media-file-123' }),
    save: jest.fn().mockResolvedValue({ id: 'media-file-123' }),
    manager: { update: jest.fn().mockResolvedValue(undefined) },
  };

  const mockStorageService = {
    getDriver: jest.fn().mockReturnValue('local'),
    saveFile: jest.fn().mockResolvedValue({
      storageKey: 'exports/vehicle-report.pdf',
      publicUrl: 'http://localhost:3000/uploads/exports/vehicle-report.pdf',
      sizeBytes: 1000,
    }),
  };

  const makeJob = (data: Partial<Record<string, unknown>> = {}) => ({
    id: 'bull-job-1',
    name: 'export:vehicle',
    data: {
      backgroundJobId: 'bg-job-1',
      from: '2026-07-01',
      to: '2026-07-31',
      format: 'pdf',
      content: 'both',
      filters: { vehicleType: null, zoneId: null },
      requestedByEmail: 'test@test.com',
      ...data,
    },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDataService.listRegistrationsForExport.mockResolvedValue([]);
    mockDataService.getTrafficStats.mockResolvedValue({
      summary: {
        total_events: 0,
        total_matched: 0,
        total_unmatched: 0,
        total_enter: 0,
        total_leave: 0,
        total_seen: 0,
        unique_vehicles: 0,
      },
      series: [],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehicleReportWorkerProcessor,
        { provide: BackgroundJobsService, useValue: mockBackgroundJobsService },
        { provide: VehicleReportDataService, useValue: mockDataService },
        {
          provide: getRepositoryToken(MediaFileEntity),
          useValue: mockMediaFileRepo,
        },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    processor = module.get<VehicleReportWorkerProcessor>(
      VehicleReportWorkerProcessor,
    );
  });

  describe('content dispatch', () => {
    it('content=registrations calls only listRegistrationsForExport', async () => {
      await processor.processExport(
        makeJob({ content: 'registrations' }) as any,
      );

      expect(mockDataService.listRegistrationsForExport).toHaveBeenCalled();
      expect(mockDataService.getTrafficStats).not.toHaveBeenCalled();
    });

    it('content=traffic_stats calls only getTrafficStats', async () => {
      await processor.processExport(
        makeJob({ content: 'traffic_stats' }) as any,
      );

      expect(mockDataService.getTrafficStats).toHaveBeenCalled();
      expect(mockDataService.listRegistrationsForExport).not.toHaveBeenCalled();
    });

    it('content=both calls both data functions', async () => {
      await processor.processExport(makeJob({ content: 'both' }) as any);

      expect(mockDataService.listRegistrationsForExport).toHaveBeenCalled();
      expect(mockDataService.getTrafficStats).toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('markRunning → aggregate → render PDF → upload → markCompleted', async () => {
      await processor.processExport(makeJob() as any);

      expect(mockBackgroundJobsService.markRunning).toHaveBeenCalledWith(
        'bg-job-1',
      );
      expect(mockRenderPdf).toHaveBeenCalled();
      expect(mockMediaFileRepo.save).toHaveBeenCalled();
      expect(mockBackgroundJobsService.markCompleted).toHaveBeenCalled();
      expect(mockBackgroundJobsService.markFailed).not.toHaveBeenCalled();
    });

    it('renders XLSX when format is xlsx', async () => {
      await processor.processExport(makeJob({ format: 'xlsx' }) as any);

      expect(mockRenderXlsx).toHaveBeenCalled();
      expect(mockRenderPdf).not.toHaveBeenCalled();
    });
  });

  describe('empty data still completes (§0.1)', () => {
    it('markCompleted normally when no data matches filter', async () => {
      await processor.processExport(makeJob() as any);

      expect(mockBackgroundJobsService.markCompleted).toHaveBeenCalled();
      expect(mockBackgroundJobsService.markFailed).not.toHaveBeenCalled();
    });
  });

  describe('Error handling (ARCH-02)', () => {
    it('calls markFailed when data aggregation throws, does NOT throw', async () => {
      mockDataService.listRegistrationsForExport.mockRejectedValueOnce(
        new Error('DB timeout'),
      );

      await expect(
        processor.processExport(makeJob({ content: 'registrations' }) as any),
      ).resolves.toBeUndefined();

      expect(mockBackgroundJobsService.markFailed).toHaveBeenCalledWith(
        'bg-job-1',
        'DB timeout',
      );
      expect(mockBackgroundJobsService.markCompleted).not.toHaveBeenCalled();
    });

    it('calls markFailed when render throws, does NOT throw', async () => {
      mockRenderPdf.mockRejectedValueOnce(new Error('PDF render error'));

      await expect(
        processor.processExport(makeJob() as any),
      ).resolves.toBeUndefined();

      expect(mockBackgroundJobsService.markFailed).toHaveBeenCalledWith(
        'bg-job-1',
        'PDF render error',
      );
    });
  });
});
