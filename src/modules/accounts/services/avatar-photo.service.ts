import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';

import { UserEntity, AccountStatus } from '../entities/user.entity.js';
import {
  MediaFileEntity,
  MediaFileType,
  StorageProvider,
} from '../../recording/entities/media-file.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { CloudinaryService } from '../../storage/cloudinary.service.js';
import { detectImageMimeType } from '../utils/image-magic-bytes.util.js';
import { AvatarPhotoResponseDto } from '../dto/avatar-photo-response.dto.js';

export interface UploadedAvatarPhotoFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * AvatarPhotoService — ACCT-AVATAR-PHOTO-001.
 *
 * Luồng avatar hiển thị TỰ DO (không duyệt), tách biệt hoàn toàn khỏi luồng sinh trắc học
 * (BiometricSubmissionService/AdminBiometricReviewService). Xem
 * spec/features/account/feat-update-avatar-photo/spec.md.
 *
 * BR-001: chỉ feature này được ghi `users.avatar_url`.
 * BR-002: hiệu lực ngay lập tức, không có trạng thái chờ duyệt.
 * FR-003: KHÔNG tạo/cập nhật bất kỳ bản ghi `face_profiles` nào.
 */
@Injectable()
export class AvatarPhotoService {
  private readonly logger = new Logger(AvatarPhotoService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    private readonly cloudinaryService: CloudinaryService,
    private readonly configService: ConfigService,
  ) {}

  async updateAvatarPhoto(
    userId: string,
    file: UploadedAvatarPhotoFile | undefined,
  ): Promise<AvatarPhotoResponseDto> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, accountStatus: true },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'Không tìm thấy tài khoản.',
      });
    }
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_ACTIVE',
        message: 'Tài khoản không ở trạng thái active.',
      });
    }

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        code: 'AVATAR_PHOTO_FILE_REQUIRED',
        message: 'Vui lòng đính kèm ảnh đại diện.',
      });
    }

    const maxBytes = this.configService.get<number>(
      'AVATAR_PHOTO_MAX_BYTES',
      DEFAULT_MAX_BYTES,
    );
    if (file.size > maxBytes) {
      throw new BadRequestException({
        code: 'AVATAR_PHOTO_FILE_TOO_LARGE',
        message: `Ảnh vượt quá giới hạn ${maxBytes} bytes.`,
      });
    }

    const detectedMime = detectImageMimeType(file.buffer);
    if (!detectedMime) {
      throw new BadRequestException({
        code: 'AVATAR_PHOTO_FILE_TYPE_INVALID',
        message: 'Ảnh phải có định dạng JPEG, PNG hoặc WEBP.',
      });
    }

    let upload: { publicId: string; secureUrl: string };
    try {
      upload = await this.cloudinaryService.uploadImage(file.buffer);
    } catch (error) {
      this.logger.error(
        `Cloudinary upload failed for user ${userId}.`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadGatewayException({
        code: 'AVATAR_PHOTO_STORAGE_FAILED',
        message: 'Không thể lưu ảnh lên kho lưu trữ. Vui lòng thử lại.',
      });
    }

    const now = new Date();
    const mediaFileId = randomUUID();

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(MediaFileEntity).insert({
        id: mediaFileId,
        fileName: upload.publicId.split('/').pop() ?? upload.publicId,
        fileType: MediaFileType.IMAGE,
        mimeType: detectedMime,
        storageProvider: StorageProvider.CLOUD_PROVIDER,
        storageKey: upload.publicId,
        fileUrl: upload.secureUrl,
        relatedEntityType: 'user_avatar',
        relatedEntityId: userId,
        uploadedBy: userId,
        isActive: true,
      });

      await manager.getRepository(UserEntity).update(userId, {
        avatarUrl: upload.secureUrl,
      });

      await manager.getRepository(AuditLogEntity).insert({
        userId,
        actionType: 'avatar.updated',
        entityType: 'users',
        entityId: userId,
        newValueJson: { avatarUrl: upload.secureUrl, mediaFileId },
      });
    });

    return {
      avatarUrl: upload.secureUrl,
      updatedAt: now.toISOString(),
    };
  }
}
