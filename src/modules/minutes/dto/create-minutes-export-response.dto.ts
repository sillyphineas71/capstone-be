import type { MinutesExportFormat } from './create-minutes-export.dto.js';

/**
 * Response 202 cho POST /meeting-minutes/:id/exports.
 * Client poll GET /background-jobs/:jobId → outputFileId, sau đó
 * GET /media-files/:fileId → downloadUrl (signed).
 */
export class CreateMinutesExportResponseDto {
  jobId: string;
  status: 'queued';
  minutesId: string;
  format: MinutesExportFormat;
  estimatedCompletion: string | null;

  constructor(data: Partial<CreateMinutesExportResponseDto>) {
    Object.assign(this, data);
  }
}
