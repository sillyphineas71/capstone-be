import * as crypto from 'crypto';
import * as fs from 'fs';
import { Client } from 'minio';

export interface MinioAudioLoaderConfig {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export interface DownloadAudioParams {
  storageBucket?: string;
  storageKey: string;
  destPath: string;
  /** sha256 hex kỳ vọng (optional) — nếu có, mismatch sẽ throw CHECKSUM_MISMATCH. */
  expectedChecksum?: string;
}

export function loadMinioConfigFromEnv(): MinioAudioLoaderConfig {
  const endpoint = (process.env['STORAGE_S3_ENDPOINT'] || 'localhost').replace(
    /^https?:\/\//,
    '',
  );
  return {
    endpoint,
    port: Number(process.env['STORAGE_S3_PORT'] || '9000'),
    useSSL: process.env['STORAGE_S3_USE_SSL'] === 'true',
    accessKey: process.env['STORAGE_S3_ACCESS_KEY'] || '',
    secretKey: process.env['STORAGE_S3_SECRET_KEY'] || '',
    bucket: process.env['STORAGE_S3_BUCKET'] || '',
  };
}

export function createMinioClient(config: MinioAudioLoaderConfig): Client {
  return new Client({
    endPoint: config.endpoint,
    port: config.port,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
  });
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

/**
 * Tải audio gốc từ MinIO private bucket về temp file local (T010).
 * Không dùng public URL, không tạo signed URL cho worker — worker đọc trực
 * tiếp bằng access key/secret key nội bộ. Không log access key/secret.
 */
export async function downloadAudioFromMinio(
  client: Client,
  config: MinioAudioLoaderConfig,
  params: DownloadAudioParams,
): Promise<{ path: string; sizeBytes: number }> {
  const bucket = params.storageBucket || config.bucket;
  if (!bucket) {
    throw new Error('MINIO_BUCKET_NOT_CONFIGURED');
  }

  console.error(
    JSON.stringify({
      event: 'audio_download_start',
      bucket,
      storageKey: params.storageKey,
    }),
  );

  try {
    await client.fGetObject(bucket, params.storageKey, params.destPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/NoSuchKey|NotFound|404/i.test(message)) {
      throw new Error(`SOURCE_AUDIO_NOT_FOUND: ${bucket}/${params.storageKey}`);
    }
    throw new Error(`MINIO_DOWNLOAD_FAILED: ${message}`);
  }

  if (!fs.existsSync(params.destPath)) {
    throw new Error(`SOURCE_AUDIO_NOT_FOUND: ${bucket}/${params.storageKey}`);
  }

  if (params.expectedChecksum) {
    const actual = await sha256OfFile(params.destPath);
    if (actual.toLowerCase() !== params.expectedChecksum.toLowerCase()) {
      throw new Error('CHECKSUM_MISMATCH');
    }
  }

  const sizeBytes = fs.statSync(params.destPath).size;
  console.error(
    JSON.stringify({ event: 'audio_download_done', bucket, sizeBytes }),
  );
  return { path: params.destPath, sizeBytes };
}
