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
import { VehicleReportDataService } from '../services/vehicle-report-data.service.js';
import {
  renderVehiclePdf,
  type VehicleReportData,
} from '../renderers/vehicle-pdf-renderer.js';
import { renderVehicleXlsx } from '../renderers/vehicle-xlsx-renderer.js';
import { StorageService } from '../../storage/storage.service.js';

interface VehicleExportJobData {
  backgroundJobId: string;
  from: string;
  to: string;
  format: 'pdf' | 'xlsx';
  content: 'registrations' | 'traffic_stats' | 'both';
  filters: { vehicleType: string | null; zoneId: string | null };
  requestedByEmail: string;
}

/**
 * VehicleReportWorkerProcessor — UC-128.
 *
 * QUAN TRỌNG: plain @Injectable(), KHÔNG @Processor/WorkerHost — mirror
 * RoomUtilizationReportWorkerProcessor/GateAccessReportWorkerProcessor. Chỉ
 * MeetingActivityReportWorkerProcessor giữ @Processor duy nhất, dispatch sang
 * class này khi job.name === 'export:vehicle'.
 */
@Injectable()
export class VehicleReportWorkerProcessor {
  private readonly logger = new Logger(VehicleReportWorkerProcessor.name);

  constructor(
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly dataService: VehicleReportDataService,
    @InjectRepository(MediaFileEntity)
    private readonly mediaFileRepo: Repository<MediaFileEntity>,
    private readonly storageService: StorageService,
  ) {}

  async processExport(job: Job<VehicleExportJobData>): Promise<void> {
    const { backgroundJobId } = job.data;
    this.logger.log(
      `Processing job ${job.id} — bgJob=${backgroundJobId} content=${job.data.content} format=${job.data.format}`,
    );

    try {
      await this.backgroundJobsService.markRunning(backgroundJobId);

      const params = {
        from: job.data.from,
        to: job.data.to,
        filters: job.data.filters,
      };

      const reportData: VehicleReportData = {};
      if (job.data.content === 'registrations' || job.data.content === 'both') {
        reportData.registrations =
          await this.dataService.listRegistrationsForExport(params);
      }
      if (job.data.content === 'traffic_stats' || job.data.content === 'both') {
        reportData.trafficStats =
          await this.dataService.getTrafficStats(params);
      }

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
        fileBuffer = await renderVehicleXlsx(reportData, meta);
        mimeType =
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        fileExt = 'xlsx';
      } else {
        fileBuffer = await renderVehiclePdf(reportData, meta);
        mimeType = 'application/pdf';
        fileExt = 'pdf';
      }

      const saveResult = await this.storageService.saveFile({
        buffer: fileBuffer,
        originalName: `vehicle-report.${fileExt}`,
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
