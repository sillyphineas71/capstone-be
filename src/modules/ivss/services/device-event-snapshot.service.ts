import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StorageService } from '../../storage/storage.service.js';

interface EventRow {
  snapshot_file_id: string | null;
}
interface MediaFileRow {
  storage_key: string;
  mime_type: string;
  file_name: string;
}

export interface DeviceEventSnapshot {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

/**
 * DeviceEventSnapshotService (F-F) — đọc ảnh snapshot đã lưu bởi F-B/F-C/F-D
 * (iot_device_events.snapshot_file_id → media_files). READ-ONLY, KHÔNG đụng luồng
 * ghi. Stream bytes trực tiếp (KHÔNG trả publicUrl) — storage local hiện KHÔNG có
 * static file serving nào wire vào STORAGE_PUBLIC_BASE_URL, nên chỉ cách chắc chắn
 * chạy đúng trên cả driver local/s3 là đọc bytes qua storageService.downloadFile().
 */
@Injectable()
export class DeviceEventSnapshotService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
  ) {}

  async getSnapshot(eventId: string): Promise<DeviceEventSnapshot> {
    const eventRows: EventRow[] = await this.dataSource.manager.query(
      `SELECT snapshot_file_id FROM iot_device_events WHERE id = $1 LIMIT 1`,
      [eventId],
    );
    const snapshotFileId = eventRows[0]?.snapshot_file_id;
    if (!snapshotFileId) {
      throw new NotFoundException({
        code: 'DEVICE_EVENT_SNAPSHOT_NOT_FOUND',
        message: 'Sự kiện không tồn tại hoặc không có ảnh snapshot.',
      });
    }

    const mediaRows: MediaFileRow[] = await this.dataSource.manager.query(
      `SELECT storage_key, mime_type, file_name FROM media_files WHERE id = $1 LIMIT 1`,
      [snapshotFileId],
    );
    const media = mediaRows[0];
    if (!media) {
      throw new NotFoundException({
        code: 'DEVICE_EVENT_SNAPSHOT_NOT_FOUND',
        message: 'File ảnh snapshot không tồn tại.',
      });
    }

    const buffer = await this.storageService.downloadFile(media.storage_key);
    return {
      buffer,
      mimeType: media.mime_type,
      fileName: media.file_name,
    };
  }
}
