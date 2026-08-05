import { DataSource } from 'typeorm';
import { StorageService } from '../../modules/storage/storage.service.js';
import { decodeBase64Image } from './decode-base64-image.util.js';

export interface SaveEventSnapshotParams {
  /** Ảnh base64 thô từ device/bridge (có/không prefix data URL). */
  imageBase64: string | null | undefined;
  /** Subfolder trong storage (vd 'stranger-snapshots', 'anpr-snapshots'). */
  folder: string;
  /** media_files.related_entity_type (free text, KHÔNG FK) — để phân biệt nguồn. */
  relatedEntityType: string;
}

/**
 * Lưu snapshot ảnh (base64 → Buffer → storageService.saveFile → INSERT media_files)
 * → trả về media_files.id (dùng làm iot_device_events.snapshot_file_id), null nếu
 * không có ảnh hoặc decode thất bại. Dùng chung cho IVSS (F-B/F-C) và ANPR (F-D) —
 * mirror pattern face-profile.service.ts (media_files là bảng file DÙNG CHUNG, KHÔNG
 * lưu base64 thô vào bất kỳ cột JSON/text nào).
 *
 * KHÔNG throw khi thiếu ảnh (trả null) — LỖI storage/DB thì throw để caller tự quyết
 * NotThrow theo context của mình (webhook always-ack).
 */
export async function saveEventSnapshot(
  dataSource: DataSource,
  storageService: StorageService,
  params: SaveEventSnapshotParams,
): Promise<string | null> {
  const decoded = decodeBase64Image(params.imageBase64);
  if (!decoded) return null;

  const ext = decoded.mimeType.split('/')[1] || 'jpg';
  const saved = await storageService.saveFile({
    buffer: decoded.buffer,
    originalName: `snapshot.${ext}`,
    folder: params.folder,
  });
  const storageProvider = storageService.getDriver() === 's3' ? 's3' : 'local';

  const rows: Array<{ id: string }> = await dataSource.manager.query(
    `INSERT INTO media_files
       (file_name, file_type, mime_type, storage_provider, storage_key,
        file_size_bytes, related_entity_type)
     VALUES ($1, 'image', $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      saved.storageKey.split('/').pop() ?? saved.storageKey,
      decoded.mimeType,
      storageProvider,
      saved.storageKey,
      String(saved.sizeBytes),
      params.relatedEntityType,
    ],
  );
  return rows[0]?.id ?? null;
}
