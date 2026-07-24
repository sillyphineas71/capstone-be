import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';

import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { BackgroundJobEntity } from '../../administration/entities/background-job.entity.js';
import {
  MediaFileEntity,
  MediaFileType,
  MediaVisibilityLevel,
  StorageProvider,
} from '../../recording/entities/media-file.entity.js';
import { GateAccessReportDataService } from '../services/gate-access-report-data.service.js';
import { renderGateAccessPdf } from '../renderers/gate-access-pdf-renderer.js';
import { renderGateAccessXlsx } from '../renderers/gate-access-xlsx-renderer.js';
import { StorageService } from '../../storage/storage.service.js';

interface GateAccessExportJobData {
  backgroundJobId: string;
  from: string;
  to: string;
  format: 'pdf' | 'xlsx';
  scope: {
    zoneId: string | null;
    departmentId: string | null;
    userId: string | null;
  };
  requestedByEmail: string;
}

/**
 * GateAccessReportWorkerProcessor — UC-127.
 *
 * QUAN TRỌNG: plain @Injectable(), KHÔNG @Processor/WorkerHost — mirror
 * RoomUtilizationReportWorkerProcessor. Chỉ MeetingActivityReportWorkerProcessor
 * giữ @Processor(REPORT_EXPORT_QUEUE_NAME) duy nhất, dispatch sang class này khi
 * job.name === 'export:gate-access'.
 */
@Injectable()
export class GateAccessReportWorkerProcessor {
  private readonly logger = new Logger(GateAccessReportWorkerProcessor.name);

  constructor(
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly dataService: GateAccessReportDataService,
    @InjectRepository(MediaFileEntity)
    private readonly mediaFileRepo: Repository<MediaFileEntity>,
    private readonly storageService: StorageService,
  ) {}

  async processExport(job: Job<GateAccessExportJobData>): Promise<void> {
    const { backgroundJobId } = job.data;
    this.logger.log(
      `Processing job ${job.id} — bgJob=${backgroundJobId} format=${job.data.format}`,
    );

    try {
      await this.backgroundJobsService.markRunning(backgroundJobId);

      const rows = await this.dataService.listSessionsForExport({
        from: job.data.from,
        to: job.data.to,
        scope: job.data.scope,
      });

      const meta = {
        from: job.data.from,
        to: job.data.to,
        generatedAt: new Date(),
        extractedByEmail: job.data.requestedByEmail,
      };

      let fileBuffer: Buffer;
      let mimeType: string;
      let fileExt: string;

      if (job.data.format === 'xlsx') {
        fileBuffer = await renderGateAccessXlsx(rows, meta);
        mimeType =
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        fileExt = 'xlsx';
      } else {
        fileBuffer = await renderGateAccessPdf(rows, meta);
        mimeType = 'application/pdf';
        fileExt = 'pdf';
      }

      const saveResult = await this.storageService.saveFile({
        buffer: fileBuffer,
        originalName: `gate-access-report.${fileExt}`,
        folder: 'exports',
      });

      const storageProv =
        this.storageService.getDriver() === 's3'
          ? StorageProvider.S3
          : StorageProvider.LOCAL;

      const fileName = path.basename(saveResult.storageKey);

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

      await this.backgroundJobsService.markCompleted(backgroundJobId, {
        fileName,
        format: fileExt,
        outputFileId: savedMedia.id,
      });

      await this.mediaFileRepo.manager.update(
        BackgroundJobEntity,
        backgroundJobId,
        { outputFileId: savedMedia.id },
      );

      this.logger.log(
        `Job ${job.id} completed — file: ${fileName} mediaFileId: ${savedMedia.id}`,
      );
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Job ${job.id} failed — ${errMsg}`);
      await this.backgroundJobsService.markFailed(backgroundJobId, errMsg);
    }
  }
}
