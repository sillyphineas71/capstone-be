import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';

import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { BackgroundJobEntity } from '../../administration/entities/background-job.entity.js';
import {
  MediaFileEntity,
  MediaFileType,
  MediaVisibilityLevel,
  StorageProvider,
} from '../../recording/entities/media-file.entity.js';
import { MeetingActivityReportDataService } from '../services/meeting-activity-report-data.service.js';
import { renderMeetingActivityPdf } from '../renderers/meeting-activity-pdf-renderer.js';
import { renderMeetingActivityXlsx } from '../renderers/meeting-activity-xlsx-renderer.js';
import { REPORT_EXPORT_QUEUE_NAME } from '../constants/report-export-job.constants.js';
import { StorageService } from '../../storage/storage.service.js';

interface MeetingActivityExportJobData {
  backgroundJobId: string;
  from: string;
  to: string;
  format: 'pdf' | 'xlsx';
  scope: {
    departmentId: string | null;
    roomId: string | null;
    organizerId: string | null;
  };
  requestedByEmail: string;
}

/**
 * MeetingActivityReportWorkerProcessor — T028 [FR-009, FR-010].
 *
 * Xử lý job 'export:meeting-activity' từ queue 'report-export'.
 * Mirror pattern của TranscriptionWorkerProcessor:
 *  1. markRunning
 *  2. Tổng hợp dữ liệu 4 phần
 *  3. Render file (PDF hoặc XLSX)
 *  4. Lưu file local + tạo MediaFileEntity
 *  5. markCompleted + set output_file_id
 *  Catch: markFailed, KHÔNG throw tiếp (ARCH-02)
 *
 * FR-011: Khi không có cuộc họp nào → vẫn render file hợp lệ và markCompleted.
 */
@Processor(REPORT_EXPORT_QUEUE_NAME)
export class MeetingActivityReportWorkerProcessor extends WorkerHost {
  private readonly logger = new Logger(
    MeetingActivityReportWorkerProcessor.name,
  );

  constructor(
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly dataService: MeetingActivityReportDataService,
    @InjectRepository(MediaFileEntity)
    private readonly mediaFileRepo: Repository<MediaFileEntity>,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<MeetingActivityExportJobData>): Promise<void> {
    const { backgroundJobId } = job.data;

    this.logger.log(
      `Processing job ${job.id} — bgJob=${backgroundJobId} format=${job.data.format}`,
    );

    try {
      // 1. markRunning
      await this.backgroundJobsService.markRunning(backgroundJobId);

      // 2. Tổng hợp dữ liệu 4 phần (T022-T025)
      const params = {
        from: job.data.from,
        to: job.data.to,
        scope: job.data.scope,
      };

      const [metadata, kpis, statusBreakdown, meetingDetails] =
        await Promise.all([
          this.dataService.getReportMetadata(params, job.data.requestedByEmail),
          this.dataService.getCoreKpis(params),
          this.dataService.getStatusBreakdown(params),
          this.dataService.getMeetingDetailList(params),
        ]);

      const reportData = { metadata, kpis, statusBreakdown, meetingDetails };

      // 3. Render file
      let fileBuffer: Buffer;
      let mimeType: string;
      let fileExt: string;

      if (job.data.format === 'xlsx') {
        fileBuffer = await renderMeetingActivityXlsx(reportData);
        mimeType =
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        fileExt = 'xlsx';
      } else {
        fileBuffer = await renderMeetingActivityPdf(reportData);
        mimeType = 'application/pdf';
        fileExt = 'pdf';
      }

      // 4. Lưu file qua StorageService (FR-010)
      const saveResult = await this.storageService.saveFile({
        buffer: fileBuffer,
        originalName: `meeting-activity-report.${fileExt}`,
        folder: 'exports',
      });

      const storageProv =
        this.storageService.getDriver() === 's3'
          ? StorageProvider.S3
          : StorageProvider.LOCAL;

      const fileName = path.basename(saveResult.storageKey);

      // 5. Tạo MediaFileEntity
      const mediaFile = this.mediaFileRepo.create({
        fileName,
        fileType: MediaFileType.EXPORT,
        mimeType,
        storageProvider: storageProv,
        storageKey: saveResult.storageKey,
        fileSizeBytes: saveResult.sizeBytes.toString(),
        relatedEntityType: 'background_job',
        relatedEntityId: backgroundJobId,
        visibilityLevel: MediaVisibilityLevel.INTERNAL,
        isActive: true,
      });
      const savedMedia = await this.mediaFileRepo.save(mediaFile);

      // 6. markCompleted
      await this.backgroundJobsService.markCompleted(backgroundJobId, {
        fileName,
        format: fileExt,
        outputFileId: savedMedia.id,
      });

      // 7. Update output_file_id (T029 — markCompleted chưa set cột này)
      // Dùng TypeORM update thay vì raw SQL để tránh fragile updates
      await this.mediaFileRepo.manager.update(
        BackgroundJobEntity,
        backgroundJobId,
        { outputFileId: savedMedia.id },
      );

      this.logger.log(
        `Job ${job.id} completed — file: ${fileName} mediaFileId: ${savedMedia.id}`,
      );
    } catch (error: unknown) {
      const errMsg =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Job ${job.id} failed — ${errMsg}`);

      // ARCH-02: KHÔNG throw tiếp để không crash worker
      await this.backgroundJobsService.markFailed(backgroundJobId, errMsg);
    }
  }
}
