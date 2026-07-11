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
import { RoomUtilizationReportDataService } from '../services/room-utilization-report-data.service.js';
import { renderRoomUtilizationPdf } from '../renderers/room-utilization-pdf-renderer.js';
import { renderRoomUtilizationXlsx } from '../renderers/room-utilization-xlsx-renderer.js';
import { renderRoomUtilizationCsv } from '../renderers/room-utilization-csv-renderer.js';
import { StorageService } from '../../storage/storage.service.js';

interface RoomUtilizationExportJobData {
  backgroundJobId: string;
  from: string;
  to: string;
  format: 'pdf' | 'xlsx' | 'csv';
  scope: { roomId: string | null };
  requestedByEmail: string;
}

/**
 * RoomUtilizationReportWorkerProcessor — UC-RUM-16.
 *
 * QUAN TRỌNG: đây là plain @Injectable(), KHÔNG phải @Processor/WorkerHost.
 * BullMQ Worker chỉ có 1 process() nhận MỌI job trên 1 queue, không tự lọc
 * theo job.name — nếu đăng ký 2 @Processor độc lập trên cùng queue
 * 'report-export' thì 2 Worker instance sẽ ganh nhau nhận job (race), có thể
 * khiến job của feature này bị worker kia "nuốt" mà không xử lý (background_job
 * kẹt ở 'queued' vĩnh viễn). Do đó chỉ MeetingActivityReportWorkerProcessor
 * (UC-AA-12) giữ @Processor(REPORT_EXPORT_QUEUE_NAME) duy nhất cho queue này,
 * và dispatch sang class này khi job.name === 'export:room-utilization'
 * (xem meeting-activity-report-worker.processor.ts).
 *
 * Luồng xử lý (mirror UC-AA-12):
 *  1. markRunning
 *  2. Tổng hợp dữ liệu (metadata + utilization + no-show + usage-by-room +
 *     released-rooms cho pdf/xlsx; CSV dùng query row-level riêng — §0.3)
 *  3. Render file theo format
 *  4. Lưu file qua StorageService + tạo MediaFileEntity
 *  5. markCompleted + set output_file_id
 *  Catch: markFailed, KHÔNG throw tiếp (ARCH-02, nhất quán UC-AA-12)
 */
@Injectable()
export class RoomUtilizationReportWorkerProcessor {
  private readonly logger = new Logger(
    RoomUtilizationReportWorkerProcessor.name,
  );

  constructor(
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly dataService: RoomUtilizationReportDataService,
    @InjectRepository(MediaFileEntity)
    private readonly mediaFileRepo: Repository<MediaFileEntity>,
    private readonly storageService: StorageService,
  ) {}

  async processExport(job: Job<RoomUtilizationExportJobData>): Promise<void> {
    const { backgroundJobId } = job.data;
    this.logger.log(
      `Processing job ${job.id} — bgJob=${backgroundJobId} format=${job.data.format}`,
    );

    try {
      await this.backgroundJobsService.markRunning(backgroundJobId);

      const params = {
        from: job.data.from,
        to: job.data.to,
        scope: job.data.scope,
      };

      let fileBuffer: Buffer;
      let mimeType: string;
      let fileExt: string;

      if (job.data.format === 'csv') {
        const rows = await this.dataService.getCsvRows(params);
        fileBuffer = await renderRoomUtilizationCsv(rows);
        mimeType = 'text/csv';
        fileExt = 'csv';
      } else {
        const [metadata, utilization, noShow, usageByRoom, releasedRooms] =
          await Promise.all([
            this.dataService.getReportMetadata(
              params,
              job.data.requestedByEmail,
            ),
            this.dataService.getUtilizationSection(params),
            this.dataService.getNoShowSection(params),
            this.dataService.getActualUsageByRoom(params),
            this.dataService.getReleasedRooms(params),
          ]);
        const reportData = {
          metadata,
          utilization,
          noShow,
          usageByRoom,
          releasedRooms,
        };

        if (job.data.format === 'xlsx') {
          fileBuffer = await renderRoomUtilizationXlsx(reportData);
          mimeType =
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          fileExt = 'xlsx';
        } else {
          fileBuffer = await renderRoomUtilizationPdf(reportData);
          mimeType = 'application/pdf';
          fileExt = 'pdf';
        }
      }

      const saveResult = await this.storageService.saveFile({
        buffer: fileBuffer,
        originalName: `room-utilization-report.${fileExt}`,
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
