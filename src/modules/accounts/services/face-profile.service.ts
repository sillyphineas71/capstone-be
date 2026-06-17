import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../entities/face-profile.entity.js';
import { StorageService } from '../../storage/storage.service.js';

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
          profileCode: `FP-${randomUUID().slice(0, 8)}`,
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

  /** Ticket B: đọc bytes portrait của user (local). null nếu không có. */
  async getPortraitBytes(userId: string): Promise<Buffer | null> {
    const face = await this.faceProfileRepo.findOne({ where: { userId } });
    if (!face || !face.primaryImageFileId) return null;

    const rows: Array<{ storage_key: string; storage_provider: string }> =
      await this.dataSource.manager.query(
        `SELECT storage_key, storage_provider FROM media_files WHERE id = $1 LIMIT 1`,
        [face.primaryImageFileId],
      );
    const media = rows?.[0];
    if (!media || media.storage_provider !== 'local') return null;

    return this.storageService.getFile(media.storage_key);
  }
}
