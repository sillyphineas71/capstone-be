import * as fs from 'fs';
import * as path from 'path';
import type { Client } from 'minio';
import {
  downloadAudioFromMinio,
  MinioAudioLoaderConfig,
} from './minio-audio-loader';

export interface FetchAudioParams {
  storageBucket?: string;
  storageKey: string;
  destPath: string;
}

/**
 * Đọc audio từ ĐĨA LOCAL (STORAGE_DRIVER=local).
 *
 * An toàn vì worker luôn là tiến trình con của API (execFile trong
 * transcription-worker.processor.ts) -> cùng máy, cùng cwd, cùng env.
 * `storageKey` mà API sinh ra là đường dẫn tương đối so với STORAGE_LOCAL_PATH.
 */
function fetchFromLocalDisk(params: FetchAudioParams): void {
  const localRoot = path.resolve(process.env['STORAGE_LOCAL_PATH'] || './uploads');
  const srcPath = path.resolve(localRoot, params.storageKey);

  // Chặn path traversal: storageKey đến từ DB nhưng vẫn phải khoá trong thư mục gốc.
  if (!srcPath.startsWith(localRoot + path.sep)) {
    throw new Error(`SOURCE_AUDIO_INVALID_PATH: ${params.storageKey}`);
  }
  if (!fs.existsSync(srcPath)) {
    throw new Error(`SOURCE_AUDIO_NOT_FOUND: ${srcPath}`);
  }
  fs.copyFileSync(srcPath, params.destPath);
}

/**
 * Bug #2 (2026-07-29): App lưu file ra đĩa local (STORAGE_DRIVER=local mặc
 * định) nhưng worker trước đây chỉ biết gọi downloadAudioFromMinio() — không
 * có nhánh đọc đĩa, không đọc STORAGE_DRIVER. fetchAudio() điều phối theo
 * STORAGE_DRIVER, thay cho việc gọi thẳng MinIO ở transcription-job-runner.ts.
 */
export async function fetchAudio(
  client: Client | null,
  minioConfig: MinioAudioLoaderConfig | null,
  params: FetchAudioParams,
): Promise<void> {
  const driver = (process.env['STORAGE_DRIVER'] || 'local').toLowerCase();

  if (driver === 'local') {
    fetchFromLocalDisk(params);
    return;
  }
  if (!client || !minioConfig) {
    throw new Error('MINIO_NOT_CONFIGURED: STORAGE_DRIVER=s3 nhưng thiếu cấu hình MinIO');
  }
  await downloadAudioFromMinio(client, minioConfig, params);
}
