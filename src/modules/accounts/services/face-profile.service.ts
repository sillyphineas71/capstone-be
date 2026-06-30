import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../entities/face-profile.entity.js';
import { StorageService } from '../../storage/storage.service.js';
import { generateFaceProfileCode } from '../utils/face-profile-code.util.js';

export interface UploadedPortrait {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const ALLOWED_MIME = ['image/jpeg', 'image/png'];
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * FaceProfileService (FPE-001 / UC-17) — enroll portrait + đọc portrait bytes (cho Ticket B).
 *
 * SEC-03: validate file server-side. DATA-01: dùng media_files/face_profiles có sẵn (KHÔNG migration).
 * media_files entity ở module recording → INSERT/SELECT raw qua dataSource.manager.
 */
@Injectable()
export class FaceProfileService {
  private readonly logger = new Logger(FaceProfileService.name);

  constructor(
    @InjectRepository(FaceProfileEntity)
    private readonly faceProfileRepo: Repository<FaceProfileEntity>,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

  /** UC-17: lưu ảnh chân dung → media_files → upsert face_profiles. */
  async enrollPortrait(
    userId: string,
    file: UploadedPortrait | undefined,
    enrolledBy: string | null,
  ): Promise<{ faceProfileId: string; mediaFileId: string; status: string }> {
    if (!file || !file.buffer) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Portrait file is required.',
      });
    }
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: 'Portrait must be image/jpeg or image/png.',
      });
    }
    const maxBytes = this.configService.get<number>(
      'FACE_PORTRAIT_MAX_BYTES',
      DEFAULT_MAX_BYTES,
    );
    if (file.size > maxBytes) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: `Portrait exceeds ${maxBytes} bytes.`,
      });
    }

    const saved = await this.storageService.saveFile({
      buffer: file.buffer,
      originalName: file.originalname,
      folder: 'face-profiles',
    });

    const insert: Array<{ id: string }> = await this.dataSource.manager.query(
      `INSERT INTO media_files
         (file_name, file_type, mime_type, storage_provider, storage_key,
          file_size_bytes, uploaded_by, related_entity_type, related_entity_id)
       VALUES ($1,'image',$2,'local',$3,$4,$5,'face_profile',$6)
       RETURNING id`,
      [
        saved.storageKey.split('/').pop() ?? saved.storageKey,
        file.mimetype,
        saved.storageKey,
        String(file.size),
        enrolledBy,
        userId,
      ],
    );
    const mediaFileId = insert[0].id;

    const now = new Date();
    const existing = await this.faceProfileRepo.findOne({ where: { userId } });
    let faceProfileId: string;
    if (existing) {
      await this.faceProfileRepo.update(existing.id, {
        primaryImageFileId: mediaFileId,
        status: FaceProfileStatus.PENDING_REVIEW,
        enrolledBy,
        lastUpdatedAt: now,
        sampleCount: (existing.sampleCount ?? 0) + 1,
      });
      faceProfileId = existing.id;
    } else {
      const created = await this.faceProfileRepo.save(
        this.faceProfileRepo.create({
          userId,
          profileCode: generateFaceProfileCode(),
          status: FaceProfileStatus.PENDING_REVIEW,
          primaryImageFileId: mediaFileId,
          enrolledBy,
          enrolledAt: now,
          sampleCount: 1,
        }),
      );
      faceProfileId = created.id;
    }

    return {
      faceProfileId,
      mediaFileId,
      status: FaceProfileStatus.PENDING_REVIEW,
    };
  }

  /**
   * Ticket B / FPB-001: đọc bytes portrait ĐÃ DUYỆT (ACTIVE) của user.
   * local → đọc đĩa; cloud_provider → tải từ file_url (Cloudinary https). null nếu không có/lỗi.
   */
  async getPortraitBytes(userId: string): Promise<Buffer | null> {
    // R2 + VAL-01: chỉ lấy ảnh ĐÃ DUYỆT (ACTIVE). 1 user chỉ 1 ACTIVE (approve revoke cái cũ).
    const face = await this.faceProfileRepo.findOne({
      where: { userId, status: FaceProfileStatus.ACTIVE },
    });
    if (!face || !face.primaryImageFileId) return null;

    const rows: Array<{
      storage_key: string;
      storage_provider: string;
      file_url: string | null;
    }> = await this.dataSource.manager.query(
      `SELECT storage_key, storage_provider, file_url
       FROM media_files WHERE id = $1 LIMIT 1`,
      [face.primaryImageFileId],
    );
    const media = rows?.[0];
    if (!media) return null;

    // R4: local (luồng cũ) — đọc đĩa. getFile() đồng bộ (Buffer), throw nếu thiếu/path lạ.
    if (media.storage_provider === 'local') {
      try {
        return this.storageService.getFile(media.storage_key);
      } catch {
        return null;
      }
    }

    // R3 + R5: cloud (Cloudinary) — tải từ file_url (secureUrl https) → Buffer.
    if (media.storage_provider === 'cloud_provider') {
      if (!media.file_url) return null;
      try {
        const res = await fetch(media.file_url);
        if (!res.ok) {
          this.logger.warn(
            `getPortraitBytes: Cloudinary fetch ${res.status} for user ${userId}.`,
          );
          return null;
        }
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
      } catch (e) {
        this.logger.warn(
          `getPortraitBytes: Cloudinary fetch error user ${userId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        return null;
      }
    }

    // provider lạ → null an toàn.
    return null;
  }
}
