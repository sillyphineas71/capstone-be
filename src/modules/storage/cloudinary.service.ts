import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import type { UploadApiResponse } from 'cloudinary';

export interface CloudinaryUploadResult {
  /** Cloudinary public_id — lưu vào media_files.storage_key */
  publicId: string;
  /** Cloudinary secure_url (https) — lưu vào media_files.file_url */
  secureUrl: string;
}

/**
 * CloudinaryService — ACCT-AVATAR-SUBMIT-001 (BR-013).
 *
 * Quản lý upload/delete ảnh avatar self-service lên Cloudinary (MVP).
 * Tách riêng khỏi StorageService (local adapter) để không ảnh hưởng các flow đang dùng local.
 *
 * Config qua env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
 */
@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
      secure: true,
    });
    this.logger.log('CloudinaryService initialized');
  }

  /**
   * Upload buffer ảnh lên Cloudinary qua upload_stream.
   * @param buffer Nội dung ảnh đã validate.
   * @param folder Thư mục trên Cloudinary (mặc định lấy từ CLOUDINARY_AVATAR_FOLDER).
   */
  async uploadImage(
    buffer: Buffer,
    folder?: string,
  ): Promise<CloudinaryUploadResult> {
    const targetFolder =
      folder ??
      this.configService.get<string>('CLOUDINARY_AVATAR_FOLDER', 'avatars');

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
   * Xóa object trên Cloudinary theo public_id (best-effort cleanup — EH-01).
   * Ném lỗi để caller quyết định log; KHÔNG nuốt lỗi tại đây.
   */
  async deleteImage(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  }
}
