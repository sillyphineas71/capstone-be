/**
 * meeting-activity-report-worker.processor.spec.ts
 *
 * Unit tests cho MeetingActivityReportWorkerProcessor (T037).
 *
 * AC-001: Happy path — markRunning → aggregate → render → upload → markCompleted với outputFileId
 * AC-007: Lỗi giữa chừng → markFailed, KHÔNG throw, KHÔNG treo ở running
 * FR-011: Dữ liệu rỗng (không meeting) → vẫn markCompleted bình thường
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MeetingActivityReportWorkerProcessor } from '../processors/meeting-activity-report-worker.processor.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { MeetingActivityReportDataService } from '../services/meeting-activity-report-data.service.js';
import { MediaFileEntity } from '../../recording/entities/media-file.entity.js';
import { StorageService } from '../../storage/storage.service.js';

// Mock renderers — must be defined BEFORE module imports
const mockRenderPdf = jest.fn().mockResolvedValue(Buffer.from('PDF_CONTENT'));
const mockRenderXlsx = jest.fn().mockResolvedValue(Buffer.from('XLSX_CONTENT'));

jest.mock('../renderers/meeting-activity-pdf-renderer.js', () => ({
  renderMeetingActivityPdf: (...args: unknown[]) => mockRenderPdf(...args),
}));
jest.mock('../renderers/meeting-activity-xlsx-renderer.js', () => ({
  renderMeetingActivityXlsx: (...args: unknown[]) => mockRenderXlsx(...args),
}));

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

describe('MeetingActivityReportWorkerProcessor', () => {
  let processor: MeetingActivityReportWorkerProcessor;

  const mockBackgroundJobsService = {
    markRunning: jest.fn().mockResolvedValue(undefined),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };

  const mockDataService = {
    getReportMetadata: jest.fn().mockResolvedValue({
      organizationLabel: 'Test Org',
      period: { from: '2026-07-01', to: '2026-07-31' },
      extractedByEmail: 'test@test.com',
      generatedAt: new Date(),
    }),
    getCoreKpis: jest.fn().mockResolvedValue({
      meetingCount: 10,
      reservationUtilizationRate: 75.5,
      noShowRate: 5.0,
      onTimeRate: 90.0,
    }),
    getStatusBreakdown: jest.fn().mockResolvedValue([
      { status: 'Completed', count: 8, percentage: 80 },
      { status: 'Cancelled', count: 1, percentage: 10 },
      { status: 'No-show', count: 1, percentage: 10 },
      { status: 'Scheduled', count: 0, percentage: 0 },
    ]),
    getMeetingDetailList: jest.fn().mockResolvedValue([]),
  };

  const mockMediaFileRepo = {
    create: jest.fn().mockReturnValue({ id: 'media-file-123' }),
    save: jest.fn().mockResolvedValue({ id: 'media-file-123' }),
    manager: {
      query: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };

  const mockStorageService = {
    getDriver: jest.fn().mockReturnValue('local'),
    saveFile: jest.fn().mockResolvedValue({
      storageKey: 'exports/test-report.pdf',
      publicUrl: 'http://localhost:3000/uploads/exports/test-report.pdf',
      sizeBytes: 1234,
    }),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('./storage/recordings'),
  };

  const makeJob = (data: Partial<{
    backgroundJobId: string;
    from: string;
    to: string;
    format: string;
    scope: { departmentId: null; roomId: null; organizerId: null };
    requestedByEmail: string;
  }> = {}) => ({
    id: 'bull-job-1',
    data: {
      backgroundJobId: 'bg-job-1',
      from: '2026-07-01',
      to: '2026-07-31',
      format: 'pdf',
      scope: { departmentId: null, roomId: null, organizerId: null },
      requestedByEmail: 'test@test.com',
      ...data,
    },
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingActivityReportWorkerProcessor,
        { provide: BackgroundJobsService, useValue: mockBackgroundJobsService },
        { provide: MeetingActivityReportDataService, useValue: mockDataService },
        { provide: getRepositoryToken(MediaFileEntity), useValue: mockMediaFileRepo },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    processor = module.get<MeetingActivityReportWorkerProcessor>(
      MeetingActivityReportWorkerProcessor,
    );
  });

  // ─── AC-001: Happy path ───────────────────────────────────────────────────────

  describe('AC-001 — Happy path', () => {
    it('markRunning → aggregate → render PDF → upload media → markCompleted with outputFileId', async () => {
      await processor.process(makeJob() as any);

      // markRunning called first
      expect(mockBackgroundJobsService.markRunning).toHaveBeenCalledWith('bg-job-1');

      // Data service methods all called
      expect(mockDataService.getReportMetadata).toHaveBeenCalled();
      expect(mockDataService.getCoreKpis).toHaveBeenCalled();
      expect(mockDataService.getStatusBreakdown).toHaveBeenCalled();
      expect(mockDataService.getMeetingDetailList).toHaveBeenCalled();

      // MediaFile saved
      expect(mockMediaFileRepo.save).toHaveBeenCalled();

      // markCompleted called (not markFailed)
      expect(mockBackgroundJobsService.markCompleted).toHaveBeenCalled();
      expect(mockBackgroundJobsService.markFailed).not.toHaveBeenCalled();

      // output_file_id updated in DB
      expect(mockMediaFileRepo.manager.update).toHaveBeenCalledWith(
        expect.any(Function), // BackgroundJobEntity
        'bg-job-1',
        { outputFileId: 'media-file-123' },
      );
    });

    it('renders XLSX when format is xlsx', async () => {
      jest.clearAllMocks();
      // Reset mocks that were cleared
      mockBackgroundJobsService.markRunning.mockResolvedValue(undefined);
      mockBackgroundJobsService.markCompleted.mockResolvedValue(undefined);
      mockMediaFileRepo.create.mockReturnValue({ id: 'media-file-123' });
      mockMediaFileRepo.save.mockResolvedValue({ id: 'media-file-123' });
      mockMediaFileRepo.manager.update.mockResolvedValue(undefined);
      mockStorageService.saveFile.mockResolvedValue({
        storageKey: 'exports/test-report.xlsx',
        publicUrl: 'http://localhost:3000/uploads/exports/test-report.xlsx',
        sizeBytes: 1234,
      });
      mockDataService.getReportMetadata.mockResolvedValue({
        organizationLabel: 'Test',
        period: { from: '2026-07-01', to: '2026-07-31' },
        extractedByEmail: 'test@test.com',
        generatedAt: new Date(),
      });
      mockDataService.getCoreKpis.mockResolvedValue({ meetingCount: 5, reservationUtilizationRate: 0, noShowRate: 0, onTimeRate: 0 });
      mockDataService.getStatusBreakdown.mockResolvedValue([]);
      mockDataService.getMeetingDetailList.mockResolvedValue([]);

      await processor.process(makeJob({ format: 'xlsx' }) as any);

      expect(mockRenderXlsx).toHaveBeenCalled();
      expect(mockBackgroundJobsService.markCompleted).toHaveBeenCalled();
    });
  });

  // ─── AC-007: Error handling ───────────────────────────────────────────────────

  describe('AC-007 — Error handling (ARCH-02)', () => {
    it('calls markFailed when aggregate throws, does NOT throw out of process()', async () => {
      mockDataService.getCoreKpis.mockRejectedValueOnce(
        new Error('DB connection timeout'),
      );

      // Should NOT throw
      await expect(
        processor.process(makeJob() as any),
      ).resolves.toBeUndefined();

      expect(mockBackgroundJobsService.markFailed).toHaveBeenCalledWith(
        'bg-job-1',
        'DB connection timeout',
      );
      // Must not stay in running state
      expect(mockBackgroundJobsService.markCompleted).not.toHaveBeenCalled();
    });

    it('calls markFailed when render throws, does NOT throw', async () => {
      mockRenderPdf.mockRejectedValueOnce(new Error('PDF render error'));

      await expect(
        processor.process(makeJob() as any),
      ).resolves.toBeUndefined();

      expect(mockBackgroundJobsService.markFailed).toHaveBeenCalledWith(
        'bg-job-1',
        'PDF render error',
      );
    });
  });

  // ─── FR-011: Empty data ───────────────────────────────────────────────────────

  describe('FR-011 — Empty data still completes', () => {
    it('markCompleted normally even when no meetings in period', async () => {
      mockDataService.getMeetingDetailList.mockResolvedValueOnce([]); // no meetings
      mockDataService.getCoreKpis.mockResolvedValueOnce({
        meetingCount: 0,
        reservationUtilizationRate: 0,
        noShowRate: 0,
        onTimeRate: 0,
      });

      await processor.process(makeJob() as any);

      // Should complete normally, not fail
      expect(mockBackgroundJobsService.markCompleted).toHaveBeenCalled();
      expect(mockBackgroundJobsService.markFailed).not.toHaveBeenCalled();
    });
  });
});
