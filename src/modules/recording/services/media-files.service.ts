import { Injectable, NotFoundException } from '@nestjs/common';
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
}

/**
 * MediaFilesService (REC-006) — list/detail/playback-resolve/visibility cho media_files local.
 * Soft-delete qua @DeleteDateColumn (deleted_at). KHÔNG migration (DATA-01).
 */
@Injectable()
export class MediaFilesService {
  constructor(
    @InjectRepository(MediaFileEntity)
    private readonly repo: Repository<MediaFileEntity>,
    private readonly configService: ConfigService,
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

  /** UC-121: chi tiết đầy đủ (gồm metadataJson.probe). */
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
    };
  }

  /**
   * UC-122 (v1 local): resolve file để controller stream.
   * SEC: storage_key resolve PHẢI nằm trong RECORDING_STORAGE_PATH (chống path traversal).
   */
  async resolvePlayback(
    fileId: string,
  ): Promise<{ path: string; size: number; mimeType: string }> {
    const m = await this.loadActive(fileId);
    if (m.storageProvider !== StorageProvider.LOCAL || !m.storageKey) {
      throw this.notFound();
    }

    const baseDir = this.configService.get<string>(
      'RECORDING_STORAGE_PATH',
      './storage/recordings',
    );
    const base = fs.realpathSync(path.resolve(baseDir));
    const resolved = path.resolve(m.storageKey);
    if (!resolved.startsWith(base + path.sep)) {
      throw this.notFound(); // file ngoài storage dir → KHÔNG serve.
    }
    if (!fs.existsSync(resolved)) {
      throw this.notFound();
    }
    const size = fs.statSync(resolved).size;
    return { path: resolved, size, mimeType: m.mimeType };
  }

  /**
   * ACCT-AVATAR-REVIEW-001: resolve cho secure-download — hỗ trợ cả
   * local (stream từ đĩa) và cloud_provider (redirect sang file_url,
   * VD: Cloudinary, vì backend không lưu bytes của các file này).
   */
  async resolveSecureDownload(
    fileId: string,
  ): Promise<
    | { kind: 'redirect'; url: string }
    | { kind: 'local'; path: string; size: number; mimeType: string }
  > {
    const m = await this.loadActive(fileId);
    if (m.storageProvider === StorageProvider.CLOUD_PROVIDER) {
      if (!m.fileUrl) throw this.notFound();
      return { kind: 'redirect', url: m.fileUrl };
    }
    const playback = await this.resolvePlayback(fileId);
    return { kind: 'local', ...playback };
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
    };
  }
}
