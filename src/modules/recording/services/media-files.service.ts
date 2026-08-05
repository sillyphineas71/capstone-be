import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  MediaFileEntity,
  StorageProvider,
} from '../entities/media-file.entity.js';
import { ListMediaQueryDto } from '../dto/list-media-query.dto.js';
import { VisibilityDto } from '../dto/visibility.dto.js';
import { StorageService } from '../../storage/storage.service.js';

/**
 * Kết quả resolve 1 media file để stream. `local` = đọc từ đĩa, `remote` = đọc từ
 * bucket s3/MinIO qua StorageService. Controller phân nhánh theo `kind`.
 */
export type ResolvedMedia =
  | {
      kind: 'local';
      path: string;
      size: number;
      mimeType: string;
      fileName: string;
    }
  | {
      kind: 'remote';
      storageKey: string;
      size: number;
      mimeType: string;
      fileName: string;
    };

export interface MediaSummary {
  id: string;
  fileName: string;
  fileType: string;
  mimeType: string;
  fileSizeBytes: string | null;
  durationSeconds: number | null;
  visibilityLevel: string;
  isActive: boolean;
  uploadedAt: Date;
  recordingSessionId: string | null;
  channelUserId: string | null;
}

/**
 * MediaFilesService (REC-006) — list/detail/playback-resolve/visibility cho media_files local.
 * Soft-delete qua @DeleteDateColumn (deleted_at). KHÔNG migration (DATA-01).
 */
@Injectable()
export class MediaFilesService {
  private readonly logger = new Logger(MediaFilesService.name);

  constructor(
    @InjectRepository(MediaFileEntity)
    private readonly repo: Repository<MediaFileEntity>,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  /** UC-120: list theo meeting, phân trang, ẩn deleted. */
  async list(
    meetingId: string,
    query: ListMediaQueryDto,
  ): Promise<{
    items: MediaSummary[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);

    const qb = this.repo
      .createQueryBuilder('m')
      .where('m.meetingId = :meetingId', { meetingId })
      .andWhere('m.deletedAt IS NULL');

    if (query.fileType) {
      const types = query.fileType
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (types.length) {
        qb.andWhere('m.fileType IN (:...types)', { types });
      }
    }

    qb.orderBy('m.uploadedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((m) => this.toSummary(m)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** UC-121/UC-140: chi tiết đầy đủ (gồm metadataJson.probe + Signed URL khi cần). */
  async detail(fileId: string): Promise<Record<string, unknown>> {
    const m = await this.loadActive(fileId);
    return {
      id: m.id,
      fileCode: m.fileCode,
      fileName: m.fileName,
      fileType: m.fileType,
      mimeType: m.mimeType,
      storageProvider: m.storageProvider,
      storageBucket: m.storageBucket,
      fileSizeBytes: m.fileSizeBytes,
      durationSeconds: m.durationSeconds,
      checksum: m.checksum,
      versionNo: m.versionNo,
      visibilityLevel: m.visibilityLevel,
      isActive: m.isActive,
      relatedEntityType: m.relatedEntityType,
      relatedEntityId: m.relatedEntityId,
      recordingSessionId: m.recordingSessionId,
      uploadedAt: m.uploadedAt,
      metadataJson: m.metadataJson,
      downloadUrl: this.buildSignedDownloadUrl(m),
    };
  }

  /**
   * UC-140 (BR2): sinh Signed URL để client tải/mở file.
   * - `cloud_provider` (VD: Cloudinary): dùng thẳng file_url công khai đã lưu.
   * - `local`/`s3`/`minio`: sinh short-lived signed token qua secure-download endpoint.
   * Trả null nếu không sinh được (không chặn response detail chỉ vì lỗi này).
   */
  private buildSignedDownloadUrl(m: MediaFileEntity): string | null {
    if (m.storageProvider === StorageProvider.CLOUD_PROVIDER) {
      return m.fileUrl ?? null;
    }
    try {
      const baseUrl = this.configService
        .get<string>('API_PUBLIC_BASE_URL', 'http://localhost:3000')
        .replace(/\/$/, '');
      const ttl = this.configService.get<number>(
        'MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS',
        600,
      );
      const signed = this.storageService.generateSignedDownloadToken(m.id, ttl);
      return `${baseUrl}/api/v1/media-files/${m.id}/secure-download?token=${signed.token}`;
    } catch (err) {
      this.logger.warn(
        `Failed to generate signed download URL for ${m.id}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /**
   * UC-122: resolve file để controller stream.
   *
   * Hỗ trợ CẢ HAI nơi lưu, vì hai luồng ghi dữ liệu khác nhau:
   *  - `local`  — ffmpeg ghi video thẳng ra đĩa (recording-session.service.ts hard-code
   *    'local'). SEC: storage_key PHẢI nằm trong RECORDING_STORAGE_PATH (chống traversal).
   *  - `s3`/`minio` — audio upload đi qua StorageService, lưu `storageProvider: <driver>`.
   *
   * Trước 2026-07-31 hàm này chỉ chấp nhận LOCAL, nên sau khi deploy đổi sang
   * STORAGE_DRIVER=s3 thì MỌI file upload đều 404 (kể cả file tồn tại thật trong bucket) —
   * kéo theo cả secure-download vì nó gọi lại hàm này.
   */
  async resolvePlayback(fileId: string): Promise<ResolvedMedia> {
    const m = await this.loadActive(fileId);
    if (!m.storageKey) {
      throw this.notFound();
    }

    if (
      m.storageProvider === StorageProvider.S3 ||
      m.storageProvider === StorageProvider.MINIO
    ) {
      // Object key luôn là đường dẫn tương đối trong bucket — chặn key tuyệt đối
      // hoặc có '..' trước khi đưa xuống SDK.
      if (m.storageKey.startsWith('/') || m.storageKey.includes('..')) {
        throw this.notFound();
      }
      let size: number;
      try {
        size = await this.storageService.getObjectSize(m.storageKey);
      } catch (err) {
        // Object không còn trong bucket (hoặc bucket/driver sai cấu hình) → 404,
        // KHÔNG lộ chi tiết hạ tầng ra response.
        this.logger.warn(
          `Playback resolve failed for ${m.id} (key=${m.storageKey}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw this.notFound();
      }
      return {
        kind: 'remote',
        storageKey: m.storageKey,
        size,
        mimeType: m.mimeType,
        fileName: m.fileName,
      };
    }

    if (m.storageProvider !== StorageProvider.LOCAL) {
      throw this.notFound();
    }

    // `storageProvider: local` che 2 quy ước ghi file khác nhau:
    //  - ffmpeg ghi video thẳng ra đĩa (recording-session.service.ts) → storage_key
    //    là ĐƯỜNG DẪN TUYỆT ĐỐI đã nằm sẵn dưới RECORDING_STORAGE_PATH.
    //  - Mọi upload qua StorageService (audio track khi STORAGE_DRIVER=local, agenda
    //    attachment — feat-attach-meeting-agenda-document, minutes attachment, ...)
    //    → storage_key là KEY TƯƠNG ĐỐI (vd 'agenda-attachments/<uuid>.pdf'), không
    //    hề nằm dưới RECORDING_STORAGE_PATH. Trước 2026-08-05, nhánh này bị đối xử
    //    như ffmpeg-video nên mọi file loại thứ 2 ném ENOENT/500 khi tải (agenda
    //    attachment upload 201 OK nhưng secure-download luôn 500 — không do
    //    STORAGE_DRIVER=s3 như bug 2026-07-31 mà do lẫn 2 quy ước path khi driver=local).
    if (!path.isAbsolute(m.storageKey)) {
      let size: number;
      try {
        size = await this.storageService.getObjectSize(m.storageKey);
      } catch (err) {
        this.logger.warn(
          `Local (StorageService) resolve failed for ${m.id} (key=${m.storageKey}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw this.notFound();
      }
      return {
        kind: 'remote',
        storageKey: m.storageKey,
        size,
        mimeType: m.mimeType,
        fileName: m.fileName,
      };
    }

    const baseDir = this.configService.get<string>(
      'RECORDING_STORAGE_PATH',
      './storage/recordings',
    );
    let base: string;
    try {
      base = fs.realpathSync(path.resolve(baseDir));
    } catch {
      // Thư mục recordings chưa từng được tạo (chưa có video nào ghi trên môi
      // trường này) → file chắc chắn không tồn tại, trả 404 sạch thay vì để
      // realpathSync ném ENOENT chưa bắt (crash 500).
      throw this.notFound();
    }
    const resolved = path.resolve(m.storageKey);
    if (!resolved.startsWith(base + path.sep)) {
      throw this.notFound(); // file ngoài storage dir → KHÔNG serve.
    }
    if (!fs.existsSync(resolved)) {
      throw this.notFound();
    }
    const size = fs.statSync(resolved).size;
    return {
      kind: 'local',
      path: resolved,
      size,
      mimeType: m.mimeType,
      fileName: m.fileName,
    };
  }

  /**
   * ACCT-AVATAR-REVIEW-001: resolve cho secure-download — hỗ trợ local (đĩa),
   * s3/minio (stream từ bucket) và cloud_provider (redirect sang file_url,
   * VD: Cloudinary, vì backend không lưu bytes của các file này).
   */
  async resolveSecureDownload(
    fileId: string,
  ): Promise<{ kind: 'redirect'; url: string } | ResolvedMedia> {
    const m = await this.loadActive(fileId);
    if (m.storageProvider === StorageProvider.CLOUD_PROVIDER) {
      if (!m.fileUrl) throw this.notFound();
      return { kind: 'redirect', url: m.fileUrl };
    }
    return this.resolvePlayback(fileId);
  }

  /** UC-123: hide (is_active=false) hoặc soft_delete (deleted_at). */
  async setVisibility(
    fileId: string,
    dto: VisibilityDto,
  ): Promise<{ fileId: string; isActive: boolean; updatedAt: Date }> {
    const m = await this.loadActive(fileId);
    const updatedAt = new Date();
    if (dto.action === 'hide') {
      await this.repo.update(fileId, { isActive: false });
      return { fileId, isActive: false, updatedAt };
    }
    // soft_delete
    await this.repo.softDelete(fileId);
    return { fileId, isActive: m.isActive, updatedAt };
  }

  /** Load 1 media_file chưa xóa mềm; 404 nếu thiếu/đã xóa. */
  private async loadActive(fileId: string): Promise<MediaFileEntity> {
    const m = await this.repo.findOne({ where: { id: fileId } });
    if (!m) throw this.notFound();
    return m;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'MEDIA_FILE_NOT_FOUND',
      message: 'Media file not found.',
    });
  }

  private toSummary(m: MediaFileEntity): MediaSummary {
    return {
      id: m.id,
      fileName: m.fileName,
      fileType: m.fileType,
      mimeType: m.mimeType,
      fileSizeBytes: m.fileSizeBytes,
      durationSeconds: m.durationSeconds,
      visibilityLevel: m.visibilityLevel,
      isActive: m.isActive,
      uploadedAt: m.uploadedAt,
      recordingSessionId: m.recordingSessionId,
      channelUserId: m.channelUserId,
    };
  }
}
