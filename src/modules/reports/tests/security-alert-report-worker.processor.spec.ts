/**
 * security-alert-report-worker.processor.spec.ts
 *
 * Unit tests cho SecurityAlertReportWorkerProcessor (UC-129 T321).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SecurityAlertReportWorkerProcessor } from '../processors/security-alert-report-worker.processor.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { SecurityAlertReportDataService } from '../services/security-alert-report-data.service.js';
import { MediaFileEntity } from '../../recording/entities/media-file.entity.js';
import { StorageService } from '../../storage/storage.service.js';

const mockRenderPdf = jest.fn().mockResolvedValue(Buffer.from('PDF_CONTENT'));
const mockRenderXlsx = jest.fn().mockResolvedValue(Buffer.from('XLSX_CONTENT'));

jest.mock('../renderers/security-alert-pdf-renderer.js', () => ({
  renderSecurityAlertPdf: (...args: unknown[]) => mockRenderPdf(...args),
}));
jest.mock('../renderers/security-alert-xlsx-renderer.js', () => ({
  renderSecurityAlertXlsx: (...args: unknown[]) => mockRenderXlsx(...args),
}));

describe('SecurityAlertReportWorkerProcessor', () => {
  let processor: SecurityAlertReportWorkerProcessor;

  const mockBackgroundJobsService = {
    markRunning: jest.fn().mockResolvedValue(undefined),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };

  const mockDataService = {
    listAllForExport: jest.fn().mockResolvedValue([]),
    mapToExportRow: jest.fn((a: any) => a),
    getStatusCounts: jest
      .fn()
      .mockReturnValue({ new: 0, acknowledged: 0, resolved: 0 }),
  };

  const mockMediaFileRepo = {
    create: jest.fn().mockReturnValue({ id: 'media-file-123' }),
    save: jest.fn().mockResolvedValue({ id: 'media-file-123' }),
    manager: { update: jest.fn().mockResolvedValue(undefined) },
  };

  const mockStorageService = {
    getDriver: jest.fn().mockReturnValue('local'),
    saveFile: jest.fn().mockResolvedValue({
      storageKey: 'exports/security-alert-report.pdf',
      publicUrl:
        'http://localhost:3000/uploads/exports/security-alert-report.pdf',
      sizeBytes: 1000,
    }),
  };

  const makeJob = (data: Partial<Record<string, unknown>> = {}) => ({
    id: 'bull-job-1',
    name: 'export:security-alert',
    data: {
      backgroundJobId: 'bg-job-1',
      from: '2026-07-01',
      to: '2026-07-31',
      format: 'pdf',
      filters: { alertType: null, zoneId: null, status: null },
      requestedByEmail: 'test@test.com',
      ...data,
    },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDataService.listAllForExport.mockResolvedValue([]);
    mockDataService.getStatusCounts.mockReturnValue({
      new: 0,
      acknowledged: 0,
      resolved: 0,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityAlertReportWorkerProcessor,
        { provide: BackgroundJobsService, useValue: mockBackgroundJobsService },
        { provide: SecurityAlertReportDataService, useValue: mockDataService },
        {
          provide: getRepositoryToken(MediaFileEntity),
          useValue: mockMediaFileRepo,
        },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    processor = module.get<SecurityAlertReportWorkerProcessor>(
      SecurityAlertReportWorkerProcessor,
    );
  });

  describe('happy path', () => {
    it('markRunning → aggregate → map → render PDF → upload → markCompleted', async () => {
      mockDataService.listAllForExport.mockResolvedValue([{ status: 'new' }]);

      await processor.processExport(makeJob() as any);

      expect(mockBackgroundJobsService.markRunning).toHaveBeenCalledWith(
        'bg-job-1',
      );
      expect(mockDataService.listAllForExport).toHaveBeenCalled();
      expect(mockDataService.mapToExportRow).toHaveBeenCalled();
      expect(mockDataService.getStatusCounts).toHaveBeenCalled();
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
    it('markCompleted normally when no alerts match filter', async () => {
      await processor.processExport(makeJob() as any);

      expect(mockBackgroundJobsService.markCompleted).toHaveBeenCalled();
      expect(mockBackgroundJobsService.markFailed).not.toHaveBeenCalled();
    });
  });

  describe('Error handling (ARCH-02)', () => {
    it('calls markFailed when data aggregation throws, does NOT throw', async () => {
      mockDataService.listAllForExport.mockRejectedValueOnce(
        new Error('DB timeout'),
      );

      await expect(
        processor.processExport(makeJob() as any),
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
