import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import type { UploadApiResponse } from 'cloudinary';
import { StorageService } from './storage.service.js';
import { detectImageMimeType } from '../accounts/utils/image-magic-bytes.util.js';
import { StorageProvider } from '../recording/entities/media-file.entity.js';

export interface CloudinaryUploadResult {
  /** Cloudinary public_id (hoặc storageKey MinIO nếu AVATAR_STORAGE_DRIVER=local) — lưu vào media_files.storage_key */
  publicId: string;
  /** Cloudinary secure_url (hoặc publicUrl MinIO nếu AVATAR_STORAGE_DRIVER=local) — lưu vào media_files.file_url */
  secureUrl: string;
}

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * CloudinaryService — ACCT-AVATAR-SUBMIT-001 (BR-013).
 *
 * Quản lý upload/delete ảnh avatar self-service. Mặc định lên Cloudinary (production).
 *
 * [Local dev 2026-08-15] Khi AVATAR_STORAGE_DRIVER=local, delegate sang StorageService
 * (MinIO/S3 driver — đã chạy local, bucket capstone-media) thay vì gọi Cloudinary SDK thật,
 * để chạy được offline. Giữ nguyên tên class/interface để không phải sửa call site
 * (avatar-photo.service.ts, biometric-submission.service.ts...).
 *
 * Config qua env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
 * AVATAR_STORAGE_DRIVER (cloudinary|local, mặc định cloudinary).
 */
@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly driver: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {
    this.driver = this.configService.get<string>(
      'AVATAR_STORAGE_DRIVER',
      'cloudinary',
    );
  }

  onModuleInit(): void {
    if (this.driver === 'local') {
      this.logger.log(
        'CloudinaryService initialized — driver: local (MinIO via StorageService)',
      );
      return;
    }
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
      secure: true,
    });
    this.logger.log('CloudinaryService initialized — driver: cloudinary');
  }

  /**
   * Upload buffer ảnh lên Cloudinary (hoặc MinIO local nếu AVATAR_STORAGE_DRIVER=local).
   * @param buffer Nội dung ảnh đã validate.
   * @param folder Thư mục đích (mặc định lấy từ CLOUDINARY_AVATAR_FOLDER).
   */
  async uploadImage(
    buffer: Buffer,
    folder?: string,
  ): Promise<CloudinaryUploadResult> {
    const targetFolder =
      folder ??
      this.configService.get<string>('CLOUDINARY_AVATAR_FOLDER', 'avatars');

    if (this.driver === 'local') {
      const mime = detectImageMimeType(buffer);
      const ext = (mime && IMAGE_EXTENSION_BY_MIME[mime]) || '.jpg';
      const result = await this.storageService.saveFile({
        buffer,
        originalName: `avatar${ext}`,
        folder: targetFolder,
      });
      return {
        publicId: result.storageKey,
        secureUrl: result.publicUrl,
      };
    }

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: targetFolder, resource_type: 'image' },
        (error, response) => {
          if (error || !response) {
            reject(
              error instanceof Error
                ? error
                : new Error('Cloudinary upload failed'),
            );
            return;
          }
          resolve(response);
        },
      );
      Readable.from(buffer).pipe(uploadStream);
    });

    return {
      publicId: result.public_id,
      secureUrl: result.secure_url,
    };
  }

  /**
   * Upload buffer file bất kỳ (docx/pptx/pdf/...) lên Cloudinary resource_type=raw
   * (hoặc MinIO local nếu AVATAR_STORAGE_DRIVER=local). Khác `uploadImage`: publicId
   * do caller truyền vào nguyên vẹn (đã gồm folder + tên + đuôi file, ví dụ
   * 'agenda-attachments/<uuid>.docx') để khớp quy ước storage_key hiện có, KHÔNG để
   * Cloudinary tự sinh id ngẫu nhiên.
   */
  async uploadRawFile(
    buffer: Buffer,
    publicId: string,
  ): Promise<CloudinaryUploadResult> {
    if (this.driver === 'local') {
      const result = await this.storageService.saveFile({
        buffer,
        originalName: publicId,
        storageKey: publicId,
      });
      return {
        publicId: result.storageKey,
        secureUrl: result.publicUrl,
      };
    }

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { public_id: publicId, resource_type: 'raw' },
        (error, response) => {
          if (error || !response) {
            reject(
              error instanceof Error
                ? error
                : new Error('Cloudinary raw upload failed'),
            );
            return;
          }
          resolve(response);
        },
      );
      Readable.from(buffer).pipe(uploadStream);
    });

    return {
      publicId: result.public_id,
      secureUrl: result.secure_url,
    };
  }

  /**
   * Xóa raw file trên Cloudinary (hoặc MinIO local) theo publicId/storageKey.
   * Tách khỏi `deleteImage` vì Cloudinary yêu cầu đúng `resource_type` lúc destroy
   * khớp với lúc upload (raw != image).
   */
  async deleteRawFile(publicId: string): Promise<void> {
    if (this.driver === 'local') {
      await this.storageService.deleteFile(publicId);
      return;
    }
    await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
  }

  /**
   * [FIX 2026-08-16] `storage_provider` THẬT SỰ của bytes vừa upload — caller PHẢI dùng
   * giá trị này khi insert `media_files.storage_provider`, KHÔNG được hard-code
   * `StorageProvider.CLOUD_PROVIDER`.
   *
   * Lý do: `media-files.service.ts` (resolveSecureDownload/buildSignedDownloadUrl) coi
   * `CLOUD_PROVIDER` là "URL công khai vĩnh viễn, cứ redirect thẳng vào file_url" — đúng cho
   * Cloudinary thật, nhưng SAI khi driver=local (MinIO): `file_url` lúc đó là
   * `StorageService.getPublicUrl()` (`STORAGE_PUBLIC_BASE_URL` + key, mặc định
   * `http://localhost:3000/uploads/...`) — backend KHÔNG có static route nào serve path này
   * (không `express.static`/`ServeStaticModule`), nên URL này LUÔN chết, kể cả khi
   * STORAGE_DRIVER=local. Object thật nằm trong bucket S3/MinIO, chỉ đọc được qua
   * `StorageService.getObjectStream()`.
   *
   * Tag đúng provider (S3/MINIO/LOCAL) để resolveSecureDownload/resolvePlayback đi đúng
   * nhánh stream-qua-token đã có sẵn và đã test (KHÔNG phải nhánh redirect).
   */
  resolveMediaStorageProvider(): StorageProvider {
    if (this.driver !== 'local') {
      return StorageProvider.CLOUD_PROVIDER;
    }
    switch (this.storageService.getDriver()) {
      case 's3':
        return StorageProvider.S3;
      case 'minio':
        return StorageProvider.MINIO;
      default:
        return StorageProvider.LOCAL;
    }
  }

  /**
   * Xóa object trên Cloudinary (hoặc MinIO local) theo publicId/storageKey (best-effort
   * cleanup — EH-01). Ném lỗi để caller quyết định log; KHÔNG nuốt lỗi tại đây.
   */
  async deleteImage(publicId: string): Promise<void> {
    if (this.driver === 'local') {
      await this.storageService.deleteFile(publicId);
      return;
    }
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  }
}
