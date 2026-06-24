import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { randomUUID } from 'crypto';

import { UserEntity, AccountStatus } from '../entities/user.entity.js';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../entities/face-profile.entity.js';
import {
  MediaFileEntity,
  MediaFileType,
  StorageProvider,
} from '../../recording/entities/media-file.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { CloudinaryService } from '../../storage/cloudinary.service.js';
import { detectImageMimeType } from '../utils/image-magic-bytes.util.js';
import { generateFaceProfileCode } from '../utils/face-profile-code.util.js';
import { AvatarSubmissionResponseDto } from '../dto/avatar-submission-response.dto.js';

export interface UploadedAvatarFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const UNIQUE_VIOLATION_CODE = '23505';
const PENDING_INDEX = 'ux_face_profiles_user_pending';

/**
 * AvatarSubmissionService — ACCT-AVATAR-SUBMIT-001 (US2).
 *
 * Xử lý POST /api/v1/me/avatar-submission theo đúng precedence (spec §11.2) và
 * transaction/insert order pre-generate UUID (spec §18.7), best-effort cleanup
 * Cloudinary khi DB transaction fail (EH-01 / EC-004).
 */
@Injectable()
export class AvatarSubmissionService {
  private readonly logger = new Logger(AvatarSubmissionService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(FaceProfileEntity)
    private readonly faceProfileRepo: Repository<FaceProfileEntity>,
    private readonly dataSource: DataSource,
    private readonly cloudinaryService: CloudinaryService,
    private readonly configService: ConfigService,
  ) {}

  async submit(
    userId: string,
    file: UploadedAvatarFile | undefined,
    consentAccepted: unknown,
  ): Promise<AvatarSubmissionResponseDto> {
    // ── Bước 3: load user (auth/permission đã check ở guard) ──
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

    // ── Bước 4: account status ──
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_ACTIVE',
        message: 'Tài khoản không ở trạng thái active.',
      });
    }

    // ── Bước 5: file bắt buộc ──
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        code: 'AVATAR_FILE_REQUIRED',
        message: 'Vui lòng đính kèm ảnh đại diện.',
      });
    }

    // ── Bước 6: kích thước file ──
    const maxBytes = this.configService.get<number>(
      'FACE_PORTRAIT_MAX_BYTES',
      DEFAULT_MAX_BYTES,
    );
    if (file.size > maxBytes) {
      throw new BadRequestException({
        code: 'AVATAR_FILE_TOO_LARGE',
        message: `Ảnh vượt quá giới hạn ${maxBytes} bytes.`,
      });
    }

    // ── Bước 7: magic bytes MIME ──
    const detectedMime = detectImageMimeType(file.buffer);
    if (!detectedMime) {
      throw new BadRequestException({
        code: 'AVATAR_FILE_TYPE_INVALID',
        message: 'Ảnh phải có định dạng JPEG, PNG hoặc WEBP.',
      });
    }

    // ── Bước 8: consent (transform multipart string → boolean) ──
    const consentOk = consentAccepted === true || consentAccepted === 'true';
    if (!consentOk) {
      throw new BadRequestException({
        code: 'AVATAR_CONSENT_REQUIRED',
        message:
          'Bạn phải đồng ý sử dụng ảnh cho mục đích nhận diện khuôn mặt.',
      });
    }

    // ── Bước 9: kiểm tra pending_review (app-level) ──
    const existingProfiles = await this.faceProfileRepo.find({
      where: { userId },
      select: { id: true, status: true },
    });
    const hasPending = existingProfiles.some(
      (p) => p.status === FaceProfileStatus.PENDING_REVIEW,
    );
    if (hasPending) {
      throw new ConflictException({
        code: 'AVATAR_ALREADY_PENDING_REVIEW',
        message:
          'Ảnh đại diện của bạn đang chờ duyệt, vui lòng đợi kết quả trước khi nộp ảnh khác.',
      });
    }

    // BR-012: lần đầu hoàn toàn vs có row cũ → audit action khác nhau.
    const isFirstEver = existingProfiles.length === 0;
    const actionType = isFirstEver ? 'avatar.upload' : 'avatar.reupload';

    // ── Bước 8b (18.7): pre-generate UUID trước khi chạm DB ──
    const faceProfileId = randomUUID();
    const mediaFileId = randomUUID();

    // ── Bước 9b (18.7): upload Cloudinary (ngoài transaction) ──
    let upload: { publicId: string; secureUrl: string };
    try {
      upload = await this.cloudinaryService.uploadImage(file.buffer);
    } catch (error) {
      this.logger.error(
        `Cloudinary upload failed for user ${userId}.`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadGatewayException({
        code: 'AVATAR_STORAGE_FAILED',
        message: 'Không thể lưu ảnh lên kho lưu trữ. Vui lòng thử lại.',
      });
    }

    const now = new Date();

    // ── Bước 10 (18.7): transaction INSERT media_files → face_profiles → audit_logs ──
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(MediaFileEntity).insert({
          id: mediaFileId,
          fileName: upload.publicId.split('/').pop() ?? upload.publicId,
          fileType: MediaFileType.IMAGE,
          mimeType: detectedMime,
          storageProvider: StorageProvider.CLOUD_PROVIDER,
          storageKey: upload.publicId,
          fileUrl: upload.secureUrl,
          relatedEntityType: 'face_profile',
          relatedEntityId: faceProfileId,
          uploadedBy: userId,
          isActive: true,
        });

        await manager.getRepository(FaceProfileEntity).insert({
          id: faceProfileId,
          userId,
          profileCode: generateFaceProfileCode(),
          status: FaceProfileStatus.PENDING_REVIEW,
          primaryImageFileId: mediaFileId,
          consentAt: now,
          enrolledBy: userId,
          enrolledAt: now,
          lastUpdatedAt: now,
          sampleCount: 1,
        });

        await manager.getRepository(AuditLogEntity).insert({
          userId,
          actionType,
          entityType: 'face_profile',
          entityId: faceProfileId,
          oldValueJson: isFirstEver
            ? null
            : { previousProfileCount: existingProfiles.length },
          newValueJson: { status: 'pending_review', mediaFileId },
        });
      });
    } catch (error) {
      // EC-003: race condition vi phạm partial unique index → map 409.
      if (
        error instanceof QueryFailedError &&
        (
          error as unknown as {
            driverError?: { code?: string; constraint?: string };
          }
        ).driverError?.code === UNIQUE_VIOLATION_CODE &&
        (error as unknown as { driverError?: { constraint?: string } })
          .driverError?.constraint === PENDING_INDEX
      ) {
        throw new ConflictException({
          code: 'AVATAR_ALREADY_PENDING_REVIEW',
          message:
            'Ảnh đại diện của bạn đang chờ duyệt, vui lòng đợi kết quả trước khi nộp ảnh khác.',
        });
      }

      // EH-01 / EC-004: lỗi DB khác → best-effort cleanup Cloudinary, trả 500.
      await this.cleanupCloudinary(upload.publicId);
      this.logger.error(
        `Avatar submission DB transaction failed for user ${userId}.`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException({
        code: 'AVATAR_UPLOAD_FAILED',
        message: 'Xử lý nộp ảnh thất bại. Vui lòng thử lại.',
      });
    }

    return {
      faceProfileId,
      avatarReviewStatus: 'pending_review',
      submittedAt: now.toISOString(),
    };
  }

  /** Best-effort xóa Cloudinary object orphan; KHÔNG ném lỗi ra ngoài (EH-01). */
  private async cleanupCloudinary(publicId: string): Promise<void> {
    try {
      await this.cloudinaryService.deleteImage(publicId);
      this.logger.log(`Cleaned up orphan Cloudinary object: ${publicId}`);
    } catch (cleanupError) {
      this.logger.warn(
        `Failed to clean up orphan Cloudinary object ${publicId}.`,
        cleanupError instanceof Error ? cleanupError.stack : undefined,
      );
    }
  }
}
