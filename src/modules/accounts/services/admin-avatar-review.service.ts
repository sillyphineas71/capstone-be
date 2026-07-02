import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../entities/face-profile.entity.js';
import { UserEntity } from '../entities/user.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import {
  NotificationEntity,
  NotificationType,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationPriority,
} from '../../notifications/entities/notification.entity.js';
import { StorageService } from '../../storage/storage.service.js';
import { ListAvatarSubmissionsQueryDto } from '../dto/list-avatar-submissions-query.dto.js';

const SORT_FIELD_MAP: Record<string, string> = {
  submittedAt: 'fp.enrolledAt',
  userFullName: 'u.fullName',
  employeeCode: 'u.employeeCode',
  departmentName: 'd.departmentName',
  status: 'fp.status',
  qualityScore: 'fp.qualityScore',
};

@Injectable()
export class AdminAvatarReviewService {
  private readonly logger = new Logger(AdminAvatarReviewService.name);

  constructor(
    @InjectRepository(FaceProfileEntity)
    private readonly faceProfileRepo: Repository<FaceProfileEntity>,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

  // ── US1: List ────────────────────────────────────────────────────────

  async listAvatarSubmissions(query: ListAvatarSubmissionsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const status = query.status ?? 'pending_review';
    const sortBy = query.sortBy ?? 'submittedAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const qb = this.faceProfileRepo
      .createQueryBuilder('fp')
      .innerJoin('fp.user', 'u')
      .leftJoin('u.department', 'd')
      .where('fp.deletedAt IS NULL')
      .andWhere('fp.status = :status', { status });

    if (query.q) {
      const searchPattern = `%${query.q}%`;
      qb.andWhere(
        '(u.fullName ILIKE :q OR u.email ILIKE :q OR u.employeeCode ILIKE :q)',
        { q: searchPattern },
      );
    }

    if (query.departmentId) {
      qb.andWhere('u.departmentId = :departmentId', {
        departmentId: query.departmentId,
      });
    }

    const sortColumn = SORT_FIELD_MAP[sortBy] ?? 'fp.enrolledAt';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    qb.orderBy(sortColumn, order);

    if (sortBy === 'qualityScore') {
      qb.addOrderBy('fp.qualityScore', order, 'NULLS LAST');
    }

    qb.skip((page - 1) * limit).take(limit);

    qb.select([
      'fp.id',
      'fp.userId',
      'fp.status',
      'fp.enrolledAt',
      'fp.primaryImageFileId',
      'fp.qualityScore',
      'u.id',
      'u.fullName',
      'u.email',
      'u.employeeCode',
      'd.id',
      'd.departmentName',
    ]);

    const [items, total] = await qb.getManyAndCount();

    return {
      data: items.map((fp) => ({
        faceProfileId: fp.id,
        userId: fp.userId,
        fullName: fp.user?.fullName ?? null,
        email: fp.user?.email ?? null,
        employeeCode: fp.user?.employeeCode ?? null,
        departmentName: fp.user?.department?.departmentName ?? null,
        status: fp.status,
        submittedAt: fp.enrolledAt,
        primaryImageFileId: fp.primaryImageFileId,
        qualityScore: fp.qualityScore !== null ? Number(fp.qualityScore) : null,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ── US1: Detail ──────────────────────────────────────────────────────

  async getAvatarSubmissionDetail(faceProfileId: string) {
    const fp = await this.faceProfileRepo.findOne({
      where: { id: faceProfileId, deletedAt: IsNull() },
      relations: { user: true },
    });

    if (!fp) {
      throw new NotFoundException({
        code: 'AVATAR_SUBMISSION_NOT_FOUND',
        message: 'Avatar submission not found.',
      });
    }

    const user = fp.user as UserEntity | undefined;
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'Owning user not found.',
      });
    }

    let imageFile: Record<string, unknown> | null = null;
    let hasPreview = false;

    if (fp.primaryImageFileId) {
      const rows: Array<{
        file_name: string;
        mime_type: string;
        file_size_bytes: string | null;
        storage_provider: string;
      }> = await this.dataSource.manager.query(
        `SELECT file_name, mime_type, file_size_bytes, storage_provider FROM media_files WHERE id = $1 AND deleted_at IS NULL`,
        [fp.primaryImageFileId],
      );
      if (rows.length > 0) {
        imageFile = {
          fileName: rows[0].file_name,
          mimeType: rows[0].mime_type,
          fileSizeBytes: rows[0].file_size_bytes,
          storageProvider: rows[0].storage_provider,
        };
        hasPreview = true;
      }
    }

    let reviewMetadata: Record<string, unknown> | null = null;
    if (fp.metadataJson?.review) {
      reviewMetadata = fp.metadataJson.review as Record<string, unknown>;
    }

    return {
      faceProfileId: fp.id,
      userId: fp.userId,
      userFullName: user.fullName,
      userEmail: user.email,
      status: fp.status,
      primaryImageFileId: fp.primaryImageFileId,
      imageFile,
      hasPreview,
      submittedAt: fp.enrolledAt,
      consentAt: fp.consentAt,
      reviewMetadata,
    };
  }

  // ── US2: Download URL ────────────────────────────────────────────────

  async getAvatarDownloadUrl(faceProfileId: string, adminUserId: string) {
    const fp = await this.faceProfileRepo.findOne({
      where: { id: faceProfileId, deletedAt: IsNull() },
    });

    if (!fp)
      throw new NotFoundException({
        code: 'AVATAR_SUBMISSION_NOT_FOUND',
        message: 'Avatar submission not found.',
      });
    if (!fp.primaryImageFileId)
      throw new NotFoundException({
        code: 'AVATAR_MEDIA_NOT_FOUND',
        message: 'Avatar media file not found.',
      });

    const rows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT id FROM media_files WHERE id = $1 AND deleted_at IS NULL`,
      [fp.primaryImageFileId],
    );
    if (rows.length === 0)
      throw new NotFoundException({
        code: 'AVATAR_MEDIA_NOT_FOUND',
        message: 'Avatar media file not found.',
      });

    const baseUrl = this.configService.get<string>(
      'API_PUBLIC_BASE_URL',
      'http://localhost:3000',
    );
    const ttl = this.configService.get<number>(
      'MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS',
      600,
    );

    let signed: { token: string; expiresAt: string };
    try {
      signed = this.storageService.generateSignedDownloadToken(rows[0].id, ttl);
    } catch (err) {
      this.logger.error(
        `Failed to generate signed download token: ${err instanceof Error ? err.message : err}`,
      );
      throw new InternalServerErrorException({
        code: 'AVATAR_DOWNLOAD_URL_FAILED',
        message: 'Failed to generate download URL.',
      });
    }

    const downloadUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/media-files/${rows[0].id}/secure-download?token=${signed.token}`;

    try {
      await this.dataSource.manager.insert(AuditLogEntity, {
        userId: adminUserId,
        actionType: 'avatar.download',
        entityType: 'face_profile',
        entityId: faceProfileId,
        severity: AuditLogSeverity.INFO,
        metadataJson: {
          targetUserId: fp.userId,
          mediaFileId: rows[0].id,
          expiresAt: signed.expiresAt,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log for download: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { downloadUrl, expiresAt: signed.expiresAt };
  }

  // ── US3: Approve (transaction) ───────────────────────────────────────

  async approveAvatarSubmission(faceProfileId: string, adminUserId: string) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const fpRows: FaceProfileEntity[] = await manager
          .createQueryBuilder(FaceProfileEntity, 'fp')
          .setLock('pessimistic_write')
          .where('fp.id = :id', { id: faceProfileId })
          .andWhere('fp.deletedAt IS NULL')
          .getMany();

        const fp = fpRows[0];
        if (!fp)
          throw new NotFoundException({
            code: 'AVATAR_SUBMISSION_NOT_FOUND',
            message: 'Avatar submission not found.',
          });

        if (fp.status !== FaceProfileStatus.PENDING_REVIEW) {
          throw new ConflictException({
            code: 'AVATAR_SUBMISSION_NOT_PENDING',
            message: 'Avatar submission is not in pending_review status.',
          });
        }

        const userRows: UserEntity[] = await manager
          .createQueryBuilder(UserEntity, 'u')
          .setLock('pessimistic_write')
          .where('u.id = :userId', { userId: fp.userId })
          .getMany();

        const user = userRows[0];
        if (!user || user.accountStatus !== 'active' || user.deletedAt) {
          throw new NotFoundException({
            code: 'USER_NOT_FOUND',
            message: 'User not found, inactive, or deleted.',
          });
        }

        if (!fp.primaryImageFileId) {
          throw new InternalServerErrorException({
            code: 'AVATAR_APPROVE_FAILED',
            message: 'Primary image file ID is missing.',
          });
        }

        const mediaRows: Array<{ file_url: string | null }> =
          await manager.query(
            `SELECT file_url FROM media_files WHERE id = $1 AND deleted_at IS NULL`,
            [fp.primaryImageFileId],
          );
        if (mediaRows.length === 0 || !mediaRows[0].file_url) {
          throw new InternalServerErrorException({
            code: 'AVATAR_APPROVE_FAILED',
            message: 'Media file record not found or has no file_url.',
          });
        }

        const now = new Date();

        const oldActive: FaceProfileEntity[] = await manager
          .createQueryBuilder(FaceProfileEntity, 'fp')
          .where('fp.userId = :userId', { userId: fp.userId })
          .andWhere('fp.status = :status', { status: FaceProfileStatus.ACTIVE })
          .andWhere('fp.id != :id', { id: faceProfileId })
          .andWhere('fp.deletedAt IS NULL')
          .getMany();

        if (oldActive.length > 0) {
          await manager.update(FaceProfileEntity, oldActive[0].id, {
            status: FaceProfileStatus.REVOKED,
            lastUpdatedAt: now,
          });
        }

        await manager.update(FaceProfileEntity, faceProfileId, {
          status: FaceProfileStatus.ACTIVE,
          lastUpdatedAt: now,
        });
        await manager.update(UserEntity, fp.userId, {
          avatarUrl: mediaRows[0].file_url,
        });

        await manager.insert(AuditLogEntity, {
          userId: adminUserId,
          actionType: 'avatar.approve',
          entityType: 'face_profile',
          entityId: faceProfileId,
          oldValueJson: { status: FaceProfileStatus.PENDING_REVIEW },
          newValueJson: {
            status: FaceProfileStatus.ACTIVE,
            avatarUrlUpdated: true,
            oldActiveFaceProfileId:
              oldActive.length > 0 ? oldActive[0].id : undefined,
          },
          severity: AuditLogSeverity.INFO,
        });

        return {
          faceProfileId,
          userId: fp.userId,
          status: FaceProfileStatus.ACTIVE,
          approvedAt: now.toISOString(),
        };
      });
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ConflictException)
        throw err;
      this.logger.error(
        `Approve avatar failed: ${err instanceof Error ? err.message : err}`,
      );
      throw new InternalServerErrorException({
        code: 'AVATAR_APPROVE_FAILED',
        message: 'Failed to approve avatar submission.',
      });
    }
  }

  // ── US4: Reject (transaction + notification) ──────────────────────────

  async rejectAvatarSubmission(
    faceProfileId: string,
    reason: string,
    adminUserId: string,
  ) {
    const normalizedReason = reason.trim().normalize('NFC');
    if (normalizedReason.length === 0) {
      throw new UnprocessableEntityException({
        code: 'AVATAR_REJECTION_REASON_REQUIRED',
        message: 'Rejection reason is required.',
      });
    }
    if (Array.from(normalizedReason).length > 500) {
      throw new UnprocessableEntityException({
        code: 'AVATAR_REJECTION_REASON_TOO_LONG',
        message: 'Rejection reason must not exceed 500 characters.',
      });
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const fpRows: FaceProfileEntity[] = await manager
          .createQueryBuilder(FaceProfileEntity, 'fp')
          .setLock('pessimistic_write')
          .where('fp.id = :id', { id: faceProfileId })
          .andWhere('fp.deletedAt IS NULL')
          .getMany();

        const fp = fpRows[0];
        if (!fp)
          throw new NotFoundException({
            code: 'AVATAR_SUBMISSION_NOT_FOUND',
            message: 'Avatar submission not found.',
          });
        if (fp.status !== FaceProfileStatus.PENDING_REVIEW) {
          throw new ConflictException({
            code: 'AVATAR_SUBMISSION_NOT_PENDING',
            message: 'Avatar submission is not in pending_review status.',
          });
        }

        const userRows: UserEntity[] = await manager
          .createQueryBuilder(UserEntity, 'u')
          .setLock('pessimistic_write')
          .where('u.id = :userId', { userId: fp.userId })
          .getMany();

        const user = userRows[0];
        if (!user || user.accountStatus !== 'active' || user.deletedAt) {
          throw new NotFoundException({
            code: 'USER_NOT_FOUND',
            message: 'User not found, inactive, or deleted.',
          });
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const reasonEscaped = normalizedReason.replace(/'/g, "''");

        await manager
          .createQueryBuilder()
          .update(FaceProfileEntity)
          .set({
            status: FaceProfileStatus.REJECTED,
            metadataJson: () =>
              `jsonb_set(COALESCE(metadata_json, '{}'::jsonb), '{review}', '{"rejectionReason": "${reasonEscaped}", "reviewedBy": "${adminUserId}", "reviewedAt": "${nowIso}"}')`,
            lastUpdatedAt: now,
          })
          .where('id = :id', { id: faceProfileId })
          .execute();

        await manager.insert(AuditLogEntity, {
          userId: adminUserId,
          actionType: 'avatar.reject',
          entityType: 'face_profile',
          entityId: faceProfileId,
          oldValueJson: { status: FaceProfileStatus.PENDING_REVIEW },
          newValueJson: { status: FaceProfileStatus.REJECTED },
          severity: AuditLogSeverity.INFO,
          metadataJson: { rejectionReason: normalizedReason },
        });

        await manager.insert(NotificationEntity, {
          notificationType: NotificationType.AVATAR_REJECTED,
          channel: NotificationChannel.IN_APP,
          subject: 'Anh dai dien khong duoc chap nhan',
          content: normalizedReason
            ? `Anh cua ban khong duoc chap nhan. Vui long upload lai anh khac.\nLy do: ${normalizedReason}`
            : 'Anh cua ban khong duoc chap nhan. Vui long upload lai anh khac.',
          relatedEntityType: 'face_profile',
          relatedEntityId: faceProfileId,
          recipientUserIdsJson: [fp.userId],
          deliveryStatus: NotificationDeliveryStatus.QUEUED,
          priority: NotificationPriority.NORMAL,
          createdBy: adminUserId,
          payloadJson: {
            reason: normalizedReason,
            reviewedBy: adminUserId,
            reviewedAt: nowIso,
          },
        });

        return {
          faceProfileId,
          userId: fp.userId,
          status: FaceProfileStatus.REJECTED,
          rejectedAt: nowIso,
        };
      });
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException ||
        err instanceof UnprocessableEntityException
      )
        throw err;
      this.logger.error(
        `Reject avatar failed: ${err instanceof Error ? err.message : err}`,
      );
      throw new InternalServerErrorException({
        code: 'AVATAR_REJECT_FAILED',
        message: 'Failed to reject avatar submission.',
      });
    }
  }
}
