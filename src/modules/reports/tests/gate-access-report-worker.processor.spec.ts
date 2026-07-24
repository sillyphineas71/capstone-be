/**
 * gate-access-report-worker.processor.spec.ts
 *
 * Unit tests cho GateAccessReportWorkerProcessor (UC-127 T120).
 * AC-001: happy path — markRunning → aggregate → render → upload → markCompleted
 * AC-006: rỗng → vẫn markCompleted (§0.1 spec, KHÔNG failed)
 * Lỗi giữa chừng → markFailed, KHÔNG throw
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GateAccessReportWorkerProcessor } from '../processors/gate-access-report-worker.processor.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { GateAccessReportDataService } from '../services/gate-access-report-data.service.js';
import { MediaFileEntity } from '../../recording/entities/media-file.entity.js';
import { StorageService } from '../../storage/storage.service.js';

const mockRenderPdf = jest.fn().mockResolvedValue(Buffer.from('PDF_CONTENT'));
const mockRenderXlsx = jest.fn().mockResolvedValue(Buffer.from('XLSX_CONTENT'));

jest.mock('../renderers/gate-access-pdf-renderer.js', () => ({
  renderGateAccessPdf: (...args: unknown[]) => mockRenderPdf(...args),
}));
jest.mock('../renderers/gate-access-xlsx-renderer.js', () => ({
  renderGateAccessXlsx: (...args: unknown[]) => mockRenderXlsx(...args),
}));

describe('GateAccessReportWorkerProcessor', () => {
  let processor: GateAccessReportWorkerProcessor;

  const mockBackgroundJobsService = {
    markRunning: jest.fn().mockResolvedValue(undefined),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };

  const mockDataService = {
    listSessionsForExport: jest.fn().mockResolvedValue([]),
  };

  const mockMediaFileRepo = {
    create: jest.fn().mockReturnValue({ id: 'media-file-123' }),
    save: jest.fn().mockResolvedValue({ id: 'media-file-123' }),
    manager: {
      update: jest.fn().mockResolvedValue(undefined),
    },
  };

  const mockStorageService = {
    getDriver: jest.fn().mockReturnValue('local'),
    saveFile: jest.fn().mockResolvedValue({
      storageKey: 'exports/gate-access-report.pdf',
      publicUrl: 'http://localhost:3000/uploads/exports/gate-access-report.pdf',
      sizeBytes: 1000,
    }),
  };

  const makeJob = (data: Partial<Record<string, unknown>> = {}) => ({
    id: 'bull-job-1',
    name: 'export:gate-access',
    data: {
      backgroundJobId: 'bg-job-1',
      from: '2026-07-01',
      to: '2026-07-31',
      format: 'pdf',
      scope: { zoneId: null, departmentId: null, userId: null },
      requestedByEmail: 'test@test.com',
      ...data,
    },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDataService.listSessionsForExport.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GateAccessReportWorkerProcessor,
        { provide: BackgroundJobsService, useValue: mockBackgroundJobsService },
        { provide: GateAccessReportDataService, useValue: mockDataService },
        {
          provide: getRepositoryToken(MediaFileEntity),
          useValue: mockMediaFileRepo,
        },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    processor = module.get<GateAccessReportWorkerProcessor>(
      GateAccessReportWorkerProcessor,
    );
  });

  describe('AC-001 — Happy path', () => {
    it('markRunning → aggregate → render PDF → upload → markCompleted with outputFileId', async () => {
      mockDataService.listSessionsForExport.mockResolvedValue([
        {
          zoneCode: 'GATE-01',
          zoneName: 'Cổng chính',
          employeeCode: 'NV001',
          fullName: 'A',
          departmentName: 'IT',
          plateNumber: null,
          checkInTime: new Date(),
          checkOutTime: new Date(),
          durationSeconds: 3600,
        },
      ]);

      await processor.processExport(makeJob() as any);

      expect(mockBackgroundJobsService.markRunning).toHaveBeenCalledWith(
        'bg-job-1',
      );
      expect(mockDataService.listSessionsForExport).toHaveBeenCalled();
      expect(mockRenderPdf).toHaveBeenCalled();
      expect(mockMediaFileRepo.save).toHaveBeenCalled();
      expect(mockBackgroundJobsService.markCompleted).toHaveBeenCalled();
      expect(mockBackgroundJobsService.markFailed).not.toHaveBeenCalled();
    });

    it('renders XLSX when format is xlsx', async () => {
      await processor.processExport(makeJob({ format: 'xlsx' }) as any);

      expect(mockRenderXlsx).toHaveBeenCalled();
      expect(mockRenderPdf).not.toHaveBeenCalled();
      expect(mockBackgroundJobsService.markCompleted).toHaveBeenCalled();
    });
  });

  describe('AC-006 — Empty data still completes (§0.1)', () => {
    it('markCompleted normally when no sessions match filter', async () => {
      mockDataService.listSessionsForExport.mockResolvedValue([]);

      await processor.processExport(makeJob() as any);

      expect(mockBackgroundJobsService.markCompleted).toHaveBeenCalled();
      expect(mockBackgroundJobsService.markFailed).not.toHaveBeenCalled();
    });
  });

  describe('Error handling (ARCH-02)', () => {
    it('calls markFailed when data aggregation throws, does NOT throw out of processExport()', async () => {
      mockDataService.listSessionsForExport.mockRejectedValueOnce(
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
