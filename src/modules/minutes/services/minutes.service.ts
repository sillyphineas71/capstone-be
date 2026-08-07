import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { DataSource, IsNull, In, Brackets, Repository } from 'typeorm';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
} from '../../meetings/entities/meeting-participant.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
  MeetingMinutesVisibilityLevel,
} from '../entities/meeting-minutes.entity.js';
import { MeetingMinutesShareEntity } from '../entities/meeting-minutes-share.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { CreateDraftMinutesDto } from '../dto/create-draft-minutes.dto.js';
import { UpdateDraftMinutesDto } from '../dto/update-draft-minutes.dto.js';
import {
  DraftMinutesResponseDto,
  MinutesAttendeeSnapshot,
} from '../dto/draft-minutes-response.dto.js';
import { MinutesQueryDto } from '../dto/minutes-query.dto.js';
import { MinutesListItemDto } from '../dto/minutes-list-item.dto.js';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { MinutesAttachmentResponseDto } from '../dto/minutes-attachment-response.dto.js';
import {
  MINUTES_ATTACHMENT_MAX_BYTES_DEFAULT,
  MINUTES_ATTACHMENT_MAX_COUNT_DEFAULT,
  MINUTES_ATTACHMENT_ALLOWED_MIME_TYPES,
} from '../constants/minutes-attachment.constants.js';
import {
  MinutesDetailResponseDto,
  MinutesGeneralInfoDto,
  MinutesMainContentDto,
  MinutesAiSummaryDto,
  MinutesRelatedResourcesDto,
  MinutesAttachmentSummaryDto,
  MinutesPermissionsDto,
  MinutesAttendeeDto,
  RoomDetailDto,
  TranscriptSummaryDto,
  RecordingSummaryDto,
} from '../dto/minutes-detail-response.dto.js';
import {
  UserEntity,
  AccountStatus,
} from '../../accounts/entities/user.entity.js';
import { TranscriptEntity } from '../../transcription/entities/transcript.entity.js';
import { StorageService } from '../../storage/storage.service.js';
import {
  MediaFileEntity,
  MediaFileType,
  StorageProvider,
} from '../../recording/entities/media-file.entity.js';
import { MinutesMeetingSummaryDto } from '../dto/minutes-meeting-summary.dto.js';
import { RoomSummaryDto } from '../../meetings/dto/room-summary.dto.js';
import { UserSummaryDto } from '../../meetings/dto/user-summary.dto.js';
import { UpdateDraftMinutesResponseDto } from '../dto/update-draft-minutes-response.dto.js';
import { SearchMinutesByPersonQueryDto } from '../dto/search-minutes-by-person-query.dto.js';
import { IssueMinutesResponseDto } from '../dto/issue-minutes-response.dto.js';
import { LinkMinutesResourcesDto } from '../dto/link-minutes-resources.dto.js';
import { LinkMinutesResourcesResponseDto } from '../dto/link-minutes-resources-response.dto.js';
import { PersonSummaryDto } from '../dto/person-summary.dto.js';
import {
  NotificationEntity,
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import { CreateMinutesShareDto } from '../dto/create-minutes-share.dto.js';
import {
  MinutesShareResponseDto,
  UnshareMinutesResponseDto,
} from '../dto/minutes-share-response.dto.js';
import {
  MinutesShareListItemDto,
  MinutesShareListResponseDto,
} from '../dto/minutes-share-list-response.dto.js';

const DEFAULT_MINUTES_CONTENT =
  '1. Thành phần tham dự\n2. Nội dung cuộc họp\n3. Kết luận\n4. Đầu việc (Action items)';

const MEETING_STATUSES_ALLOWED_FOR_MINUTES = [
  MeetingStatus.IN_PROGRESS,
  MeetingStatus.COMPLETED,
];

export interface MinutesAuthUser {
  userId: string;
}

interface CreateDraftTransactionResult {
  saved: MeetingMinutesEntity;
  meeting: MeetingEntity;
  attendeesSnapshotJson: MinutesAttendeeSnapshot[];
}

const LIST_MAX_LIMIT = 20; // BR2 (UC-MKM-02): tá»‘i Ä‘a 20 báº£n ghi/trang

const LIST_SORT_FIELD_MAP: Record<string, string> = {
  actual_start_time: 'meeting.actualStartTime',
  created_at: 'minutes.createdAt',
};

export interface MinutesListResult {
  items: MinutesListItemDto[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class MinutesService {
  private readonly logger = new Logger(MinutesService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditLogsService: AuditLogsService,
    private readonly authzRepo: AuthzReadRepository,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    @InjectRepository(MediaFileEntity)
    private readonly mediaFileRepo: Repository<MediaFileEntity>,
  ) {}

  async createDraft(
    meetingId: string,
    dto: CreateDraftMinutesDto,
    authUser: MinutesAuthUser,
  ): Promise<DraftMinutesResponseDto> {
    const result = await this.dataSource.transaction(
      async (manager): Promise<CreateDraftTransactionResult> => {
        // Step 1: Load + lock meeting (trÃ¡nh race condition táº¡o trÃ¹ng minutes)
        const meeting = await manager
          .getRepository(MeetingEntity)
          .createQueryBuilder('meeting')
          .setLock('pessimistic_write')
          .where('meeting.id = :meetingId', { meetingId })
          .getOne();

        if (!meeting || meeting.deletedAt) {
          throw new NotFoundException({
            success: false,
            message: 'Cuá»™c há»p khÃ´ng tá»“n táº¡i hoáº·c Ä‘Ã£ bá»‹ xÃ³a',
            error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
          });
        }

        // Step 2: Meeting pháº£i cÃ³ Host Ä‘Æ°á»£c gÃ¡n
        if (!meeting.hostId) {
          throw new ConflictException({
            success: false,
            message:
              'Cuá»™c há»p chÆ°a Ä‘Æ°á»£c gÃ¡n Host, khÃ´ng thá»ƒ táº¡o biÃªn báº£n há»p',
            error: {
              code: 'MEETING_HOST_NOT_ASSIGNED',
              details: { meetingId },
            },
          });
        }

        // Step 3: Chá»‰ Host cá»§a cuá»™c há»p má»›i Ä‘Æ°á»£c táº¡o (BR1)
        if (meeting.hostId !== authUser.userId) {
          throw new ForbiddenException({
            success: false,
            message:
              'Chá»‰ Host cá»§a cuá»™c há»p má»›i Ä‘Æ°á»£c táº¡o biÃªn báº£n há»p',
            error: { code: 'NOT_MEETING_HOST', details: { meetingId } },
          });
        }

        // Step 4: Meeting status guard â€” cho phÃ©p táº¡o khi Ä‘ang diá»…n ra hoáº·c Ä‘Ã£ káº¿t thÃºc
        if (meeting.status === MeetingStatus.CANCELLED) {
          throw new ConflictException({
            success: false,
            message:
              'Cuá»™c há»p Ä‘Ã£ bá»‹ há»§y, khÃ´ng thá»ƒ táº¡o biÃªn báº£n há»p',
            error: { code: 'MEETING_CANCELLED', details: { meetingId } },
          });
        }

        if (!MEETING_STATUSES_ALLOWED_FOR_MINUTES.includes(meeting.status)) {
          throw new ConflictException({
            success: false,
            message:
              'Cuá»™c há»p chÆ°a báº¯t Ä‘áº§u, chÆ°a thá»ƒ táº¡o biÃªn báº£n há»p',
            error: {
              code: 'MEETING_NOT_STARTED',
              details: { meetingId, currentStatus: meeting.status },
            },
          });
        }

        // Step 5: Chá»‘ng táº¡o trÃ¹ng â€” tá»‘i Ä‘a 1 minutes active per meeting
        const existing = await manager
          .getRepository(MeetingMinutesEntity)
          .findOne({
            where: { meetingId, deletedAt: IsNull() },
          });

        if (existing) {
          throw new ConflictException({
            success: false,
            message: 'Cuộc họp này đã có biên bản họp',
            error: {
              code: 'MINUTES_ALREADY_EXISTS',
              details: { meetingId, existingMinutesId: existing.id },
            },
          });
        }

        // Step 6: Snapshot danh sÃ¡ch tham dá»± táº¡i thá»i Ä‘iá»ƒm táº¡o (BR2 â€” khÃ³a cá»©ng)
        const participants = await manager
          .getRepository(MeetingParticipantEntity)
          .find({ where: { meetingId } });

        const attendeesSnapshotJson: MinutesAttendeeSnapshot[] =
          participants.map((p) => ({
            userId: p.userId,
            participantRole: p.participantRole,
            attendanceStatus: p.attendanceStatus,
            joinedAt: p.joinedAt,
            leftAt: p.leftAt,
          }));

        // Step 7: Táº¡o báº£n ghi draft
        const title = dto.title?.trim() || `Biên bản họp: ${meeting.title}`;

        const minutes = manager.getRepository(MeetingMinutesEntity).create({
          meetingId,
          title,
          status: MeetingMinutesStatus.DRAFT,
          visibilityLevel: MeetingMinutesVisibilityLevel.PRIVATE,
          minutesContent: DEFAULT_MINUTES_CONTENT,
          attendeesSnapshotJson: attendeesSnapshotJson as unknown as Record<
            string,
            unknown
          >,
          preparedBy: authUser.userId,
        });

        const saved = await manager
          .getRepository(MeetingMinutesEntity)
          .save(minutes);

        return { saved, meeting, attendeesSnapshotJson };
      },
    );

    // Audit log ngoÃ i transaction â€” AuditLogsService tá»± fail-safe, khÃ´ng cháº·n business flow
    await this.auditLogsService.logAction({
      userId: authUser.userId,
      actionType: 'meeting_minutes_draft_created',
      entityType: 'meeting_minutes',
      entityId: result.saved.id,
      metadataJson: { meetingId, meetingStatus: result.meeting.status },
    });

    return new DraftMinutesResponseDto({
      id: result.saved.id,
      meetingId: result.saved.meetingId,
      title: result.saved.title,
      status: result.saved.status,
      visibilityLevel: result.saved.visibilityLevel,
      versionNo: result.saved.versionNo,
      minutesContent: result.saved.minutesContent,
      preparedBy: result.saved.preparedBy as string,
      createdAt: result.saved.createdAt,
      meetingSnapshot: {
        meetingTitle: result.meeting.title,
        actualStartTime: result.meeting.actualStartTime,
        actualEndTime: result.meeting.actualEndTime,
        roomId: result.meeting.roomId,
        meetingStatus: result.meeting.status,
        attendees: result.attendeesSnapshotJson,
      },
    });
  }

  async findMinutesList(
    queryDto: MinutesQueryDto,
    authUser: MinutesAuthUser,
  ): Promise<MinutesListResult> {
    try {
      const page = Math.max(1, queryDto.page ?? 1);
      const limit = Math.min(
        LIST_MAX_LIMIT,
        Math.max(1, queryDto.limit ?? LIST_MAX_LIMIT),
      );
      const skip = (page - 1) * limit;

      const qb = this.dataSource
        .getRepository(MeetingMinutesEntity)
        .createQueryBuilder('minutes')
        .leftJoin('minutes.meeting', 'meeting')
        .leftJoin('meeting.host', 'host')
        .select([
          'minutes.id',
          'minutes.title',
          'minutes.status',
          'minutes.versionNo',
          'minutes.createdAt',
          'minutes.preparedBy',
          'minutes.aiSummaryJson',
          'meeting.id',
          'meeting.title',
          'meeting.actualStartTime',
          'meeting.actualEndTime',
          'meeting.meetingMode',
          'meeting.hostId',
          'meeting.roomId',
          'host.id',
          'host.fullName',
          'host.email',
        ])
        .where('minutes.deletedAt IS NULL');

      // Scope theo role (BR phÃ¢n quyá»n UC-MKM-02)
      const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
        authUser.userId,
      );
      const isAdmin = roles.some(
        (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
      );

      if (!isAdmin) {
        qb.andWhere(
          new Brackets((sub) => {
            sub
              .where(
                'minutes.status = :draftStatus AND minutes.preparedBy = :userId',
                {
                  draftStatus: MeetingMinutesStatus.DRAFT,
                  userId: authUser.userId,
                },
              )
              .orWhere(
                `minutes.status IN (:...visibleStatuses) AND (
                  meeting.hostId = :userId
                  OR EXISTS (
                    SELECT 1 FROM meeting_participants mp
                    WHERE mp.meeting_id = meeting.id AND mp.user_id = :userId
                  )
                )`,
                {
                  visibleStatuses: [
                    MeetingMinutesStatus.PUBLISHED,
                    MeetingMinutesStatus.ARCHIVED,
                  ],
                  userId: authUser.userId,
                },
              );
          }),
        );
      }

      // status filter (client) â€” AND thÃªm vÃ o scope, khÃ´ng thay tháº¿
      if (queryDto.status && queryDto.status !== 'all') {
        qb.andWhere('minutes.status = :clientStatus', {
          clientStatus: queryDto.status,
        });
      }

      // roomId filter
      if (queryDto.roomId) {
        qb.andWhere('meeting.roomId = :roomId', { roomId: queryDto.roomId });
      }

      // meetingId filter (tra cứu biên bản của 1 cuộc họp cụ thể)
      if (queryDto.meetingId) {
        qb.andWhere('meeting.id = :meetingId', {
          meetingId: queryDto.meetingId,
        });
      }

      // Date range filter (meeting.actualStartTime)
      if (queryDto.from && queryDto.to) {
        qb.andWhere('meeting.actualStartTime BETWEEN :from AND :to', {
          from: new Date(queryDto.from),
          to: new Date(queryDto.to),
        });
      }

      // q search: minutes.title OR meeting.title OR host.fullName
      if (queryDto.q) {
        qb.andWhere(
          '(minutes.title ILIKE :q OR meeting.title ILIKE :q OR host.fullName ILIKE :q)',
          { q: `%${queryDto.q}%` },
        );
      }

      // Sort
      const sortField =
        LIST_SORT_FIELD_MAP[queryDto.sortBy ?? ''] ??
        LIST_SORT_FIELD_MAP.actual_start_time;
      const sortOrder = queryDto.sortOrder === 'asc' ? 'ASC' : 'DESC';
      qb.orderBy(sortField, sortOrder);

      // Pagination
      qb.skip(skip).take(limit);

      const [items, total] = await qb.getManyAndCount();

      // MeetingEntity khÃ´ng cÃ³ relation `room` (chá»‰ cÃ³ cá»™t roomId) â€” batch load
      // riÃªng Ä‘á»ƒ trÃ¡nh N+1 vÃ  trÃ¡nh lá»—i hydrate cá»§a raw entity join (xem
      // research.md má»¥c "Rá»§i ro & quyáº¿t Ä‘á»‹nh thiáº¿t káº¿").
      const roomIds = Array.from(
        new Set(
          items
            .map((m) => m.meeting?.roomId)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const rooms = roomIds.length
        ? await this.dataSource
            .getRepository(RoomEntity)
            .find({ where: { id: In(roomIds) } })
        : [];
      const roomById = new Map(rooms.map((r) => [r.id, r]));

      const listItems = items.map((minutes) => {
        const meeting = minutes.meeting;
        const roomEntity = meeting?.roomId
          ? roomById.get(meeting.roomId)
          : undefined;
        const room = roomEntity
          ? new RoomSummaryDto(roomEntity.id, roomEntity.roomName)
          : null;
        const hostEntity = meeting?.host ?? null;
        const host = hostEntity
          ? new UserSummaryDto(
              hostEntity.id,
              hostEntity.fullName,
              hostEntity.email,
            )
          : null;

        return new MinutesListItemDto(
          minutes.id,
          minutes.title,
          minutes.status,
          minutes.versionNo,
          minutes.createdAt,
          new MinutesMeetingSummaryDto(
            meeting.id,
            meeting.title,
            meeting.actualStartTime,
            meeting.actualEndTime,
            meeting.meetingMode,
            room,
          ),
          host,
          minutes.aiSummaryJson != null,
        );
      });

      return { items: listItems, total, page, limit };
    } catch (error) {
      this.logger.error(
        `findMinutesList failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        success: false,
        message: 'Lá»—i há»‡ thá»‘ng',
        error: { code: 'INTERNAL_ERROR' },
      });
    }
  }

  /* ================================================
     Attachments (US1/US2/US3)
     ================================================ */

  private async loadMinutesForOwnerCheck(
    minutesId: string,
    authUserId: string,
  ): Promise<MeetingMinutesEntity> {
    const minutes = await this.dataSource
      .getRepository(MeetingMinutesEntity)
      .findOne({ where: { id: minutesId } });

    if (!minutes || minutes.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Bien ban hop khong ton tai hoac da bi xoa',
        error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
      });
    }

    if (minutes.preparedBy !== authUserId) {
      throw new ForbiddenException({
        success: false,
        message: 'Ban khong phai la nguoi soan thao bien ban hop nay',
        error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
      });
    }

    return minutes;
  }

  /**
   * Kiem tra quyen ĐỌC bien ban (UC-139/UC-140): rong hon
   * loadMinutesForOwnerCheck (upload/delete chi Host/preparer) — Host,
   * Participant (khi da published/archived) hoac Admin deu duoc xem danh
   * sach/chi tiet file dinh kem, dung voi actor trong dac ta UC-MKM.
   * Dung chung logic voi findMinutesDetail (canAccessMinutes).
   */
  private async loadMinutesForReadCheck(
    minutesId: string,
    authUserId: string,
  ): Promise<MeetingMinutesEntity> {
    const minutes = await this.dataSource
      .getRepository(MeetingMinutesEntity)
      .createQueryBuilder('minutes')
      .leftJoinAndSelect('minutes.meeting', 'meeting')
      .where('minutes.id = :minutesId', { minutesId })
      .andWhere('minutes.deletedAt IS NULL')
      .getOne();

    if (!minutes) {
      throw new NotFoundException({
        success: false,
        message: 'Bien ban hop khong ton tai hoac da bi xoa',
        error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
      });
    }

    const { roles } =
      await this.authzRepo.getEffectiveRolesAndPermissions(authUserId);
    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );

    if (!isAdmin) {
      const participantCount = await this.dataSource
        .getRepository(MeetingParticipantEntity)
        .count({
          where: { meetingId: minutes.meetingId, userId: authUserId },
        });
      const isParticipant = participantCount > 0;

      if (
        !(await this.canAccessMinutes(
          minutes,
          minutes.meeting,
          authUserId,
          false,
          isParticipant,
        ))
      ) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong co quyen xem bien ban hop nay',
          error: { code: 'MEETING_MINUTES_ACCESS_DENIED', details: {} },
        });
      }
    }

    return minutes;
  }

  async addAttachment(
    minutesId: string,
    file: any,
    authUser: MinutesAuthUser,
  ): Promise<MinutesAttachmentResponseDto> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        success: false,
        message: 'Vui long dinh kem file',
        error: { code: 'ATTACHMENT_FILE_REQUIRED', details: {} },
      });
    }

    const maxBytes = this.configService.get<number>(
      'MINUTES_ATTACHMENT_MAX_BYTES',
      MINUTES_ATTACHMENT_MAX_BYTES_DEFAULT,
    );

    if (file.size > maxBytes) {
      throw new BadRequestException({
        success: false,
        message: 'File vuot qua gioi han ' + maxBytes + ' bytes',
        error: { code: 'ATTACHMENT_FILE_TOO_LARGE', details: { maxBytes } },
      });
    }

    const allowedMimeTypes: string[] =
      this.configService.get<string[]>(
        'MINUTES_ATTACHMENT_ALLOWED_MIME_TYPES',
        MINUTES_ATTACHMENT_ALLOWED_MIME_TYPES,
      ) ?? MINUTES_ATTACHMENT_ALLOWED_MIME_TYPES;

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException({
        success: false,
        message: 'Dinh dang file khong duoc ho tro',
        error: {
          code: 'ATTACHMENT_FILE_TYPE_INVALID',
          details: { allowedMimeTypes },
        },
      });
    }

    const ext = this.getExtension(file.originalname).toLowerCase();
    const mimeToExtensions: Record<string, string[]> = {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        ['.docx'],
      'application/vnd.ms-powerpoint': ['.ppt'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        ['.pptx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
        '.xlsx',
      ],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
    };

    const allowedExtensions = mimeToExtensions[file.mimetype];
    if (!allowedExtensions || !allowedExtensions.includes(ext)) {
      throw new BadRequestException({
        success: false,
        message: 'Duoi file khong khop voi MIME type',
        error: {
          code: 'ATTACHMENT_FILE_TYPE_INVALID',
          details: { expectedExtensions: allowedExtensions },
        },
      });
    }

    const mediaFileId = randomUUID();
    let storageResult;
    try {
      storageResult = await this.storageService.saveFile({
        buffer: file.buffer,
        originalName: file.originalname,
        folder: 'minutes-attachments',
        storageKey:
          'minutes-attachments/' +
          mediaFileId +
          this.getExtension(file.originalname),
      });
    } catch (error) {
      this.logger.error(
        'Storage save failed for attachment on minutes ' + minutesId,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadGatewayException({
        success: false,
        message: 'Khong the luu file len kho luu tru',
        error: { code: 'ATTACHMENT_STORAGE_FAILED', details: {} },
      });
    }

    const now = new Date();
    const maxCount = this.configService.get<number>(
      'MINUTES_ATTACHMENT_MAX_COUNT',
      MINUTES_ATTACHMENT_MAX_COUNT_DEFAULT,
    );

    try {
      await this.dataSource.transaction(async (manager) => {
        const minutes = await manager
          .getRepository(MeetingMinutesEntity)
          .createQueryBuilder('minutes')
          .setLock('pessimistic_write')
          .where('minutes.id = :minutesId', { minutesId })
          .getOne();

        if (!minutes || minutes.deletedAt) {
          throw new NotFoundException({
            success: false,
            message: 'Bien ban hop khong ton tai hoac da bi xoa',
            error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
          });
        }

        if (minutes.preparedBy !== authUser.userId) {
          throw new ForbiddenException({
            success: false,
            message: 'Ban khong phai la nguoi soan thao bien ban hop nay',
            error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
          });
        }

        if (minutes.status !== MeetingMinutesStatus.DRAFT) {
          throw new ConflictException({
            success: false,
            message: 'Chi co the dinh kem file khi bien ban o trang thai nhap',
            error: {
              code: 'MINUTES_NOT_DRAFT',
              details: { minutesId, currentStatus: minutes.status },
            },
          });
        }

        const currentCount = await manager
          .getRepository(MediaFileEntity)
          .count({
            where: {
              relatedEntityType: 'meeting_minutes',
              relatedEntityId: minutesId,
              deletedAt: IsNull(),
            },
          });

        if (currentCount >= maxCount) {
          throw new ConflictException({
            success: false,
            message: 'Da dat so luong file dinh kem toi da',
            error: {
              code: 'ATTACHMENT_LIMIT_EXCEEDED',
              details: { maxCount, currentCount },
            },
          });
        }

        await manager.getRepository(MediaFileEntity).insert({
          id: mediaFileId,
          meetingId: minutes.meetingId,
          relatedEntityType: 'meeting_minutes',
          relatedEntityId: minutesId,
          uploadedBy: authUser.userId,
          fileName: file.originalname,
          fileType: MediaFileType.MINUTES_ATTACHMENT,
          mimeType: file.mimetype,
          storageProvider: StorageProvider.LOCAL,
          storageKey: storageResult.storageKey,
          fileUrl: storageResult.publicUrl,
          fileSizeBytes: String(storageResult.sizeBytes),
          isActive: true,
          uploadedAt: now,
        });

        await manager.getRepository(AuditLogEntity).insert({
          userId: authUser.userId,
          actionType: 'meeting_minutes_attachment_uploaded',
          entityType: 'meeting_minutes',
          entityId: minutesId,
          newValueJson: {
            mediaFileId,
            fileName: file.originalname,
            fileSizeBytes: storageResult.sizeBytes,
          },
        });
      });
    } catch (error) {
      await this.storageService
        .deleteFile(storageResult.storageKey)
        .catch((ce) => {
          this.logger.warn(
            'Failed to clean up orphan storage file: ' +
              storageResult.storageKey,
            ce instanceof Error ? ce.stack : undefined,
          );
        });
      throw error;
    }

    return new MinutesAttachmentResponseDto({
      id: mediaFileId,
      fileName: file.originalname,
      fileType: MediaFileType.MINUTES_ATTACHMENT,
      mimeType: file.mimetype,
      fileSizeBytes: String(storageResult.sizeBytes),
      fileUrl: storageResult.publicUrl,
      uploadedBy: authUser.userId,
      uploadedAt: now,
    });
  }

  async listAttachments(
    minutesId: string,
    authUser: MinutesAuthUser,
  ): Promise<{
    items: MinutesAttachmentResponseDto[];
    total: number;
    maxCount: number;
  }> {
    await this.loadMinutesForReadCheck(minutesId, authUser.userId);

    const [files, total] = await this.mediaFileRepo.findAndCount({
      where: {
        relatedEntityType: 'meeting_minutes',
        relatedEntityId: minutesId,
        deletedAt: IsNull(),
      },
      order: { uploadedAt: 'DESC' },
    });

    const maxCount = this.configService.get<number>(
      'MINUTES_ATTACHMENT_MAX_COUNT',
      MINUTES_ATTACHMENT_MAX_COUNT_DEFAULT,
    );

    const items = files.map(
      (f) =>
        new MinutesAttachmentResponseDto({
          id: f.id,
          fileName: f.fileName,
          fileType: f.fileType,
          mimeType: f.mimeType,
          fileSizeBytes: f.fileSizeBytes,
          fileUrl: f.fileUrl,
          uploadedBy: f.uploadedBy,
          uploadedAt: f.uploadedAt,
        }),
    );

    return { items, total, maxCount };
  }

  async removeAttachment(
    minutesId: string,
    fileId: string,
    authUser: MinutesAuthUser,
  ): Promise<{ fileId: string; deletedAt: Date }> {
    const result = await this.dataSource.transaction(async (manager) => {
      const minutes = await manager
        .getRepository(MeetingMinutesEntity)
        .createQueryBuilder('minutes')
        .setLock('pessimistic_write')
        .where('minutes.id = :minutesId', { minutesId })
        .getOne();

      if (!minutes || minutes.deletedAt) {
        throw new NotFoundException({
          success: false,
          message: 'Bien ban hop khong ton tai hoac da bi xoa',
          error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
        });
      }

      if (minutes.preparedBy !== authUser.userId) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong phai la nguoi soan thao bien ban hop nay',
          error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
        });
      }

      if (minutes.status !== MeetingMinutesStatus.DRAFT) {
        throw new ConflictException({
          success: false,
          message: 'Chi co the go file khi bien ban o trang thai nhap',
          error: {
            code: 'MINUTES_NOT_DRAFT',
            details: { minutesId, currentStatus: minutes.status },
          },
        });
      }

      const mediaFile = await manager.getRepository(MediaFileEntity).findOne({
        where: {
          id: fileId,
          relatedEntityType: 'meeting_minutes',
          relatedEntityId: minutesId,
          deletedAt: IsNull(),
        },
      });

      if (!mediaFile) {
        throw new NotFoundException({
          success: false,
          message: 'File dinh kem khong ton tai hoac da bi xoa',
          error: { code: 'ATTACHMENT_NOT_FOUND', details: { fileId } },
        });
      }

      const deletedAt = new Date();
      await manager
        .getRepository(MediaFileEntity)
        .update({ id: fileId }, { deletedAt });

      await manager.getRepository(AuditLogEntity).insert({
        userId: authUser.userId,
        actionType: 'meeting_minutes_attachment_deleted',
        entityType: 'meeting_minutes',
        entityId: minutesId,
        oldValueJson: { fileId, storageKey: mediaFile.storageKey },
      });

      return { fileId, deletedAt, storageKey: mediaFile.storageKey };
    });

    await this.storageService.deleteFile(result.storageKey).catch((error) => {
      this.logger.warn(
        'Failed to delete physical file from storage: ' + result.storageKey,
        error instanceof Error ? error.stack : undefined,
      );
    });

    return { fileId: result.fileId, deletedAt: result.deletedAt };
  }

  private getExtension(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
  }

  /* ================================================
     View Detail (UC-MKM-03)
     ================================================ */

  /**
   * Quyết định user có xem được biên bản không (choke-point dùng chung cho
   * findMinutesDetail + loadMinutesForReadCheck). Async vì có thêm nhánh kiểm
   * tra bảng meeting_minutes_shares (feat-share-meeting-minutes, FR-009).
   *
   * CẢNH BÁO: mọi call-site PHẢI `await` — quên `await` khiến `!Promise` luôn
   * false, vô hiệu hóa toàn bộ guard. Xem feat-share-meeting-minutes/research.md #5.
   */
  private async canAccessMinutes(
    minutes: MeetingMinutesEntity,
    meeting: MeetingEntity,
    userId: string,
    isAdmin: boolean,
    isParticipant: boolean,
  ): Promise<boolean> {
    if (isAdmin) return true;
    if (minutes.status === MeetingMinutesStatus.DRAFT) {
      return minutes.preparedBy === userId;
    }
    if (
      minutes.status === MeetingMinutesStatus.PUBLISHED ||
      minutes.status === MeetingMinutesStatus.ARCHIVED
    ) {
      const isHost = meeting.hostId === userId;
      if (isHost || isParticipant) return true;
      // Nhánh share (FR-009/FR-011): áp dụng cho cả published và archived.
      const shareCount = await this.dataSource
        .getRepository(MeetingMinutesShareEntity)
        .count({ where: { minutesId: minutes.id, userId } });
      return shareCount > 0;
    }
    return false;
  }

  async findMinutesDetail(
    id: string,
    authUser: MinutesAuthUser,
  ): Promise<MinutesDetailResponseDto> {
    const minutes = await this.dataSource
      .getRepository(MeetingMinutesEntity)
      .createQueryBuilder('minutes')
      .leftJoinAndSelect('minutes.meeting', 'meeting')
      .where('minutes.id = :id', { id })
      .andWhere('minutes.deletedAt IS NULL')
      .getOne();

    if (!minutes) {
      throw new NotFoundException({
        success: false,
        message: 'Bien ban hop khong ton tai hoac da bi xoa',
        error: { code: 'MEETING_MINUTES_NOT_FOUND', details: { id } },
      });
    }

    const meeting = minutes.meeting;
    const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
      authUser.userId,
    );
    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );

    if (!isAdmin) {
      const participantCount = await this.dataSource
        .getRepository(MeetingParticipantEntity)
        .count({
          where: { meetingId: minutes.meetingId, userId: authUser.userId },
        });
      const isParticipant = participantCount > 0;

      if (
        !(await this.canAccessMinutes(
          minutes,
          meeting,
          authUser.userId,
          false,
          isParticipant,
        ))
      ) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong co quyen xem bien ban hop nay',
          error: { code: 'MEETING_MINUTES_ACCESS_DENIED', details: {} },
        });
      }
    }

    let room: RoomDetailDto | null = null;
    if (meeting.roomId) {
      const roomEntity = await this.dataSource
        .getRepository(RoomEntity)
        .findOne({ where: { id: meeting.roomId } });
      if (roomEntity) {
        room = new RoomDetailDto({
          id: roomEntity.id,
          roomName: roomEntity.roomName,
          siteName: roomEntity.siteName,
          areaName: roomEntity.areaName,
          locationDescription: roomEntity.locationDescription,
        });
      }
    }

    const attendeeSnapshots = minutes.attendeesSnapshotJson ?? [];
    const attendeeUserIds = (attendeeSnapshots as any).map((a) => a.userId);
    const extraUserIds = [
      meeting.hostId,
      minutes.preparedBy,
      minutes.issuedBy,
      minutes.approvedBy,
    ].filter(Boolean);
    const allUserIds = Array.from(
      new Set([...attendeeUserIds, ...extraUserIds]),
    );

    let usersById = new Map<
      string,
      { id: string; fullName: string; email: string }
    >();
    if (allUserIds.length > 0) {
      const userEntities = await this.dataSource
        .getRepository(UserEntity)
        .find({ where: { id: In(allUserIds) } });
      usersById = new Map(
        userEntities.map((u) => [
          u.id,
          { id: u.id, fullName: u.fullName ?? '', email: u.email ?? '' },
        ]),
      );
    }

    let transcript: TranscriptSummaryDto | null = null;
    if (minutes.linkedTranscriptId) {
      const t = await this.dataSource.getRepository(TranscriptEntity).findOne({
        where: { id: minutes.linkedTranscriptId },
        select: { id: true, status: true, versionNo: true, languageCode: true },
      });
      if (t)
        transcript = new TranscriptSummaryDto({
          id: t.id,
          status: t.status,
          versionNo: t.versionNo,
          languageCode: t.languageCode,
        });
    }

    let recording: RecordingSummaryDto | null = null;
    if (minutes.linkedRecordingFileId) {
      const rec = await this.dataSource.getRepository(MediaFileEntity).findOne({
        where: { id: minutes.linkedRecordingFileId, deletedAt: IsNull() },
        select: {
          id: true,
          fileName: true,
          durationSeconds: true,
          mimeType: true,
        },
      });
      if (rec)
        recording = new RecordingSummaryDto({
          id: rec.id,
          fileName: rec.fileName,
          durationSeconds: rec.durationSeconds,
          mimeType: rec.mimeType,
        });
    }

    const attachmentEntities = await this.dataSource
      .getRepository(MediaFileEntity)
      .find({
        where: {
          relatedEntityType: 'meeting_minutes',
          relatedEntityId: id,
          deletedAt: IsNull(),
        },
        order: { uploadedAt: 'DESC' },
      });
    const attachments = attachmentEntities.map(
      (f) =>
        new MinutesAttachmentSummaryDto({
          id: f.id,
          fileName: f.fileName,
          fileType: f.fileType,
          mimeType: f.mimeType,
          fileSizeBytes: f.fileSizeBytes,
          uploadedBy: f.uploadedBy,
          uploadedAt: f.uploadedAt,
        }),
    );

    const attendees = ((minutes.attendeesSnapshotJson ?? []) as any).map(
      (a) =>
        new MinutesAttendeeDto({
          userId: a.userId,
          fullName: usersById.get(a.userId)?.fullName ?? '',
          email: usersById.get(a.userId)?.email ?? '',
          participantRole: a.participantRole,
          attendanceStatus: a.attendanceStatus,
          joinedAt: a.joinedAt,
          leftAt: a.leftAt,
        }),
    );

    const hostUser = meeting.hostId
      ? (usersById.get(meeting.hostId) ?? null)
      : null;
    const preparedByUser = minutes.preparedBy
      ? (usersById.get(minutes.preparedBy) ?? null)
      : null;
    const issuedByUser = minutes.issuedBy
      ? (usersById.get(minutes.issuedBy) ?? null)
      : null;
    const approvedByUser = minutes.approvedBy
      ? (usersById.get(minutes.approvedBy) ?? null)
      : null;
    const noteTakerSnapshot = (
      (minutes.attendeesSnapshotJson ?? []) as any[]
    ).find((a) => a.participantRole === ParticipantRole.NOTE_TAKER);
    const noteTakerUser = noteTakerSnapshot
      ? (usersById.get(noteTakerSnapshot.userId) ?? null)
      : null;

    const canEditOrIssue =
      minutes.status === MeetingMinutesStatus.DRAFT &&
      (isAdmin || minutes.preparedBy === authUser.userId);

    // aiSummaryJson khác NULL = biên bản có nguồn gốc AI. Expose 4 khối insight
    // + meta (read-only) cho FE; đồng thời set cờ isAiGenerated để FE phân biệt
    // nháp AI vs nháp tay và hiển thị banner "cần review".
    const aiJson = minutes.aiSummaryJson ?? null;
    const isAiGenerated = aiJson !== null;
    let aiSummary: MinutesAiSummaryDto | null = null;
    if (aiJson !== null) {
      const ai = aiJson;
      aiSummary = new MinutesAiSummaryDto({
        keyPoints: (ai.keyPoints as string[]) ?? [],
        risks: (ai.risks as string[]) ?? [],
        openQuestions: (ai.openQuestions as string[]) ?? [],
        uncertainParts: (ai.uncertainParts as string[]) ?? [],
        meta: (ai.meta as Record<string, unknown>) ?? null,
      });
    }

    return new MinutesDetailResponseDto({
      id: minutes.id,
      meetingId: minutes.meetingId,
      title: minutes.title,
      status: minutes.status,
      versionNo: minutes.versionNo,
      generalInfo: new MinutesGeneralInfoDto({
        meetingTitle: meeting.title,
        actualStartTime: meeting.actualStartTime,
        actualEndTime: meeting.actualEndTime,
        meetingMode: meeting.meetingMode,
        room,
        host: hostUser
          ? {
              id: hostUser.id,
              fullName: hostUser.fullName,
              email: hostUser.email,
            }
          : null,
        noteTaker: noteTakerUser
          ? {
              id: noteTakerUser.id,
              fullName: noteTakerUser.fullName,
              email: noteTakerUser.email,
            }
          : null,
        attendees,
      }),
      mainContent: new MinutesMainContentDto({
        minutesContent: minutes.minutesContent,
        decisions: minutes.decisionsJson as any,
        actionItems: minutes.actionItemsJson as any,
      }),
      aiSummary,
      isAiGenerated,
      relatedResources: new MinutesRelatedResourcesDto({
        transcript,
        recording,
      }),
      attachments,
      preparedBy: preparedByUser
        ? {
            id: preparedByUser.id,
            fullName: preparedByUser.fullName,
            email: preparedByUser.email,
          }
        : null,
      issuedBy: issuedByUser
        ? {
            id: issuedByUser.id,
            fullName: issuedByUser.fullName,
            email: issuedByUser.email,
          }
        : null,
      issuedAt: minutes.issuedAt,
      approvedBy: approvedByUser
        ? {
            id: approvedByUser.id,
            fullName: approvedByUser.fullName,
            email: approvedByUser.email,
          }
        : null,
      approvedAt: minutes.approvedAt,
      createdAt: minutes.createdAt,
      updatedAt: minutes.updatedAt,
      permissions: new MinutesPermissionsDto(canEditOrIssue, canEditOrIssue),
    });
  }

  async updateDraft(
    minutesId: string,
    dto: UpdateDraftMinutesDto,
    authUser: MinutesAuthUser,
  ): Promise<UpdateDraftMinutesResponseDto> {
    const updatableFields = [
      'title',
      'minutesContent',
      'decisionsJson',
      'actionItemsJson',
      'aiSummary',
    ];
    if (!updatableFields.some((f) => dto[f] !== undefined)) {
      throw new BadRequestException({
        success: false,
        message: 'Khong co truong nao duoc cap nhat',
        error: { code: 'NO_UPDATE_FIELD', details: {} },
      });
    }
    return this.dataSource
      .transaction(async (manager) => {
        const minutes = await manager
          .getRepository(MeetingMinutesEntity)
          .createQueryBuilder('minutes')
          .setLock('pessimistic_write')
          .where('minutes.id = :minutesId', { minutesId })
          .getOne();
        if (!minutes || minutes.deletedAt) {
          throw new NotFoundException({
            success: false,
            message: 'Bien ban hop khong ton tai hoac da bi xoa',
            error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
          });
        }
        const meeting = await manager
          .getRepository(MeetingEntity)
          .findOne({ where: { id: minutes.meetingId } });
        const isOwner =
          minutes.preparedBy === authUser.userId ||
          meeting?.hostId === authUser.userId;
        if (!isOwner) {
          throw new ForbiddenException({
            success: false,
            message: 'Ban khong phai la nguoi soan thao hoac host',
            error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
          });
        }
        if (minutes.status !== MeetingMinutesStatus.DRAFT) {
          throw new ConflictException({
            success: false,
            message: 'Chi co the cap nhat bien ban o trang thai nhap',
            error: {
              code: 'MINUTES_NOT_DRAFT',
              details: { minutesId, currentStatus: minutes.status },
            },
          });
        }
        if (dto.versionNo !== minutes.versionNo) {
          throw new ConflictException({
            success: false,
            message: 'Phien ban khong khop, vui long tai lai du lieu',
            error: {
              code: 'MINUTES_VERSION_CONFLICT',
              details: {
                currentVersionNo: minutes.versionNo,
                currentData: {
                  title: minutes.title,
                  minutesContent: minutes.minutesContent,
                  decisionsJson: minutes.decisionsJson,
                  actionItemsJson: minutes.actionItemsJson,
                  updatedAt: minutes.updatedAt,
                },
              },
            },
          });
        }
        if (dto.title !== undefined) minutes.title = dto.title;
        if (dto.minutesContent !== undefined)
          minutes.minutesContent = dto.minutesContent;
        if (dto.decisionsJson !== undefined)
          minutes.decisionsJson = dto.decisionsJson as any;
        if (dto.actionItemsJson !== undefined) {
          minutes.actionItemsJson = dto.actionItemsJson.map((item) => ({
            ...item,
            id: item.id ?? randomUUID(),
          })) as any;
        }
        // aiSummary: merge 4 mảng insight, GIỮ NGUYÊN meta (provenance) —
        // người dùng không được ghi đè provider/model/generatedAt.
        if (dto.aiSummary !== undefined) {
          const existingAi = minutes.aiSummaryJson ?? {};
          const merged: Record<string, unknown> = { ...existingAi };
          for (const key of [
            'keyPoints',
            'risks',
            'openQuestions',
            'uncertainParts',
          ] as const) {
            if (dto.aiSummary[key] !== undefined) {
              merged[key] = dto.aiSummary[key];
            }
          }
          minutes.aiSummaryJson = merged;
        }
        if (meeting?.status === MeetingStatus.COMPLETED) {
          const participants = await manager
            .getRepository(MeetingParticipantEntity)
            .find({ where: { meetingId: minutes.meetingId } });
          minutes.attendeesSnapshotJson = participants.map((p) => ({
            userId: p.userId,
            participantRole: p.participantRole,
            attendanceStatus: p.attendanceStatus,
            joinedAt: p.joinedAt,
            leftAt: p.leftAt,
          })) as any;
        }
        const oldVersionNo = minutes.versionNo;
        minutes.versionNo += 1;
        const saved = await manager
          .getRepository(MeetingMinutesEntity)
          .save(minutes);
        return {
          saved,
          oldVersionNo,
          updatedFields: Object.keys(dto).filter(
            (k) => k !== 'versionNo' && dto[k] !== undefined,
          ),
        };
      })
      .then(async (result) => {
        await this.auditLogsService.logEntityChange({
          userId: authUser.userId,
          actionType: 'meeting_minutes_updated',
          entityType: 'meeting_minutes',
          entityId: minutesId,
          oldValueJson: { versionNo: result.oldVersionNo },
          newValueJson: {
            versionNo: result.saved.versionNo,
            updatedFields: result.updatedFields,
          },
        });
        return new UpdateDraftMinutesResponseDto({
          id: result.saved.id,
          meetingId: result.saved.meetingId,
          title: result.saved.title,
          status: result.saved.status,
          versionNo: result.saved.versionNo,
          minutesContent: result.saved.minutesContent,
          decisionsJson: result.saved.decisionsJson,
          actionItemsJson: result.saved.actionItemsJson,
          aiSummaryJson: result.saved.aiSummaryJson,
          attendeesSnapshotJson: result.saved.attendeesSnapshotJson,
          preparedBy: result.saved.preparedBy,
          updatedAt: result.saved.updatedAt,
        });
      });
  }

  /**
   * UC-141: Lien ket/huy lien ket 1 file recording (media_files, audio/video)
   * va/hoac 1 transcript voi bien ban dang draft. Chi Host (preparedBy hoac
   * meeting.hostId) — KHONG co nhanh bypass cho Business Admin/System Admin
   * (khac voi issueMinutes/deleteDraft), theo dung quyet dinh Q&A 2026-07-17
   * (xem feat-link-minutes-resources/spec.md muc 1.5).
   */
  async linkResources(
    minutesId: string,
    dto: LinkMinutesResourcesDto,
    authUser: MinutesAuthUser,
  ): Promise<LinkMinutesResourcesResponseDto> {
    if (dto.recordingFileId === undefined && dto.transcriptId === undefined) {
      throw new BadRequestException({
        success: false,
        message: 'Khong co truong nao duoc lien ket',
        error: { code: 'NO_LINK_FIELD', details: {} },
      });
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const minutes = await manager
        .getRepository(MeetingMinutesEntity)
        .createQueryBuilder('minutes')
        .setLock('pessimistic_write')
        .where('minutes.id = :minutesId', { minutesId })
        .getOne();
      if (!minutes || minutes.deletedAt) {
        throw new NotFoundException({
          success: false,
          message: 'Bien ban hop khong ton tai hoac da bi xoa',
          error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
        });
      }

      const meeting = await manager
        .getRepository(MeetingEntity)
        .findOne({ where: { id: minutes.meetingId } });
      const isOwner =
        minutes.preparedBy === authUser.userId ||
        meeting?.hostId === authUser.userId;
      if (!isOwner) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong phai la nguoi soan thao hoac host',
          error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
        });
      }

      if (minutes.status !== MeetingMinutesStatus.DRAFT) {
        throw new ConflictException({
          success: false,
          message:
            'Chi co the lien ket tai nguyen khi bien ban o trang thai nhap',
          error: {
            code: 'MINUTES_NOT_DRAFT',
            details: { minutesId, currentStatus: minutes.status },
          },
        });
      }

      if (meeting?.status !== MeetingStatus.COMPLETED) {
        throw new ConflictException({
          success: false,
          message: 'Cuoc hop chua ket thuc, chua the lien ket tai nguyen',
          error: {
            code: 'MEETING_NOT_COMPLETED',
            details: {
              meetingId: minutes.meetingId,
              currentStatus: meeting?.status,
            },
          },
        });
      }

      if (dto.recordingFileId !== undefined && dto.recordingFileId !== null) {
        const file = await manager.getRepository(MediaFileEntity).findOne({
          where: { id: dto.recordingFileId, deletedAt: IsNull() },
        });
        if (!file) {
          throw new NotFoundException({
            success: false,
            message: 'File recording khong ton tai hoac da bi xoa',
            error: {
              code: 'RECORDING_FILE_NOT_FOUND',
              details: { recordingFileId: dto.recordingFileId },
            },
          });
        }
        if (
          file.fileType !== MediaFileType.AUDIO &&
          file.fileType !== MediaFileType.VIDEO
        ) {
          throw new BadRequestException({
            success: false,
            message: 'File duoc chon khong phai file recording (audio/video)',
            error: {
              code: 'INVALID_RECORDING_FILE_TYPE',
              details: {
                recordingFileId: dto.recordingFileId,
                fileType: file.fileType,
              },
            },
          });
        }
        if (file.meetingId !== minutes.meetingId) {
          throw new ConflictException({
            success: false,
            message: 'File recording khong thuoc cuoc hop cua bien ban nay',
            error: {
              code: 'RESOURCE_NOT_SAME_MEETING',
              details: { recordingFileId: dto.recordingFileId },
            },
          });
        }
      }

      if (dto.transcriptId !== undefined && dto.transcriptId !== null) {
        const transcript = await manager
          .getRepository(TranscriptEntity)
          .findOne({
            where: { id: dto.transcriptId },
          });
        if (!transcript) {
          throw new NotFoundException({
            success: false,
            message: 'Transcript khong ton tai',
            error: {
              code: 'TRANSCRIPT_NOT_FOUND',
              details: { transcriptId: dto.transcriptId },
            },
          });
        }
        if (transcript.meetingId !== minutes.meetingId) {
          throw new ConflictException({
            success: false,
            message: 'Transcript khong thuoc cuoc hop cua bien ban nay',
            error: {
              code: 'RESOURCE_NOT_SAME_MEETING',
              details: { transcriptId: dto.transcriptId },
            },
          });
        }
      }

      const oldValue = {
        linkedRecordingFileId: minutes.linkedRecordingFileId,
        linkedTranscriptId: minutes.linkedTranscriptId,
      };

      if (dto.recordingFileId !== undefined) {
        minutes.linkedRecordingFileId = dto.recordingFileId;
      }
      if (dto.transcriptId !== undefined) {
        minutes.linkedTranscriptId = dto.transcriptId;
      }

      const saved = await manager
        .getRepository(MeetingMinutesEntity)
        .save(minutes);
      return { saved, oldValue };
    });

    await this.auditLogsService.logEntityChange({
      userId: authUser.userId,
      actionType: 'meeting_minutes_resources_linked',
      entityType: 'meeting_minutes',
      entityId: minutesId,
      oldValueJson: result.oldValue,
      newValueJson: {
        linkedRecordingFileId: result.saved.linkedRecordingFileId,
        linkedTranscriptId: result.saved.linkedTranscriptId,
      },
    });

    return new LinkMinutesResourcesResponseDto({
      id: result.saved.id,
      linkedRecordingFileId: result.saved.linkedRecordingFileId,
      linkedTranscriptId: result.saved.linkedTranscriptId,
      updatedAt: result.saved.updatedAt,
    });
  }

  async deleteDraft(
    minutesId: string,
    authUser: MinutesAuthUser,
  ): Promise<{
    deleted: boolean;
    minutesId: string;
    deletedAt: Date;
    cascadedAttachmentCount: number;
  }> {
    const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
      authUser.userId,
    );
    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );

    const result = await this.dataSource.transaction(async (manager) => {
      const minutes = await manager
        .getRepository(MeetingMinutesEntity)
        .createQueryBuilder('minutes')
        .setLock('pessimistic_write')
        .where('minutes.id = :minutesId', { minutesId })
        .getOne();
      if (!minutes || minutes.deletedAt) {
        throw new NotFoundException({
          success: false,
          message: 'Bien ban hop khong ton tai hoac da bi xoa',
          error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
        });
      }
      if (!isAdmin) {
        const meeting = await manager
          .getRepository(MeetingEntity)
          .findOne({ where: { id: minutes.meetingId } });
        const isOwner =
          minutes.preparedBy === authUser.userId ||
          meeting?.hostId === authUser.userId;
        if (!isOwner) {
          throw new ForbiddenException({
            success: false,
            message: 'Ban khong co quyen xoa bien ban nay',
            error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
          });
        }
      }
      if (minutes.status !== MeetingMinutesStatus.DRAFT) {
        throw new ConflictException({
          success: false,
          message: 'Chi co the xoa bien ban o trang thai nhap',
          error: {
            code: 'MINUTES_NOT_DRAFT',
            details: { minutesId, currentStatus: minutes.status },
          },
        });
      }
      const deletedAt = new Date();
      await manager
        .getRepository(MeetingMinutesEntity)
        .update(
          { id: minutesId },
          { status: MeetingMinutesStatus.DELETED, deletedAt },
        );
      const attachResult = await manager.getRepository(MediaFileEntity).update(
        {
          relatedEntityType: 'meeting_minutes',
          relatedEntityId: minutesId,
          deletedAt: IsNull(),
        },
        { deletedAt },
      );
      const cascadedCount = attachResult.affected ?? 0;
      await manager.getRepository(AuditLogEntity).insert({
        userId: authUser.userId,
        actionType: 'meeting_minutes_deleted',
        entityType: 'meeting_minutes',
        entityId: minutesId,
        oldValueJson: {
          title: minutes.title,
          versionNo: minutes.versionNo,
          meetingId: minutes.meetingId,
          preparedBy: minutes.preparedBy ?? undefined,
        },
        metadataJson: {
          deletedByRole: isAdmin ? 'admin' : 'owner',
          cascadedAttachmentCount: cascadedCount,
        },
      });
      return {
        deleted: true,
        minutesId,
        deletedAt,
        cascadedAttachmentCount: cascadedCount,
      };
    });

    if (isAdmin) {
      const minutes = await this.dataSource
        .getRepository(MeetingMinutesEntity)
        .findOne({ where: { id: minutesId } });
      if (
        minutes &&
        minutes.preparedBy &&
        minutes.preparedBy !== authUser.userId
      ) {
        try {
          await this.dataSource.getRepository(NotificationEntity).insert({
            notificationType: NotificationType.MINUTES_DELETED_BY_ADMIN,
            channel: NotificationChannel.IN_APP,
            subject: 'Bien ban hop da bi xoa boi Admin',
            content: 'Bien ban hop cua ban da bi xoa boi Admin.',
            relatedEntityType: 'meeting_minutes',
            relatedEntityId: minutesId,
            recipientScope: 'user_list',
            recipientUserIdsJson: [minutes.preparedBy],
            createdBy: authUser.userId,
          });
        } catch (e) {
          this.logger.warn(
            'Failed to send notification for delete',
            e instanceof Error ? e.message : undefined,
          );
        }
      }
    }

    return result;
  }

  /**
   * Issue (publish) a meeting minutes draft to official status (UC-MKM-09).
   * Transitions status from draft to published, sets issuedBy/issuedAt,
   * writes audit log, and notifies meeting participants (best-effort).
   */
  async issueMinutes(
    minutesId: string,
    authUser: MinutesAuthUser,
  ): Promise<IssueMinutesResponseDto> {
    const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
      authUser.userId,
    );
    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );

    const result = await this.dataSource.transaction(async (manager) => {
      // Step 1: Lock row + validate existence
      const minutes = await manager
        .getRepository(MeetingMinutesEntity)
        .createQueryBuilder('minutes')
        .setLock('pessimistic_write')
        .where('minutes.id = :minutesId', { minutesId })
        .getOne();

      if (!minutes || minutes.deletedAt) {
        throw new NotFoundException({
          success: false,
          message: 'Bien ban hop khong ton tai hoac da bi xoa',
          error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
        });
      }

      // Step 2: Load meeting (read-only, need hostId + status)
      const meeting = await manager
        .getRepository(MeetingEntity)
        .findOne({ where: { id: minutes.meetingId } });

      // Step 3: Ownership-or-admin check
      if (!isAdmin) {
        const isOwner =
          minutes.preparedBy === authUser.userId ||
          meeting?.hostId === authUser.userId;
        if (!isOwner) {
          throw new ForbiddenException({
            success: false,
            message: 'Ban khong co quyen ban hanh bien ban nay',
            error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
          });
        }
      }

      // Step 4: Status must be draft
      if (minutes.status !== MeetingMinutesStatus.DRAFT) {
        throw new ConflictException({
          success: false,
          message: 'Chi co the ban hanh bien ban o trang thai nhap',
          error: {
            code: 'MINUTES_NOT_DRAFT',
            details: { minutesId, currentStatus: minutes.status },
          },
        });
      }

      // Step 5: Meeting must be completed
      if (meeting?.status !== MeetingStatus.COMPLETED) {
        throw new ConflictException({
          success: false,
          message: 'Cuoc hop chua ket thuc, khong the ban hanh bien ban',
          error: {
            code: 'MEETING_NOT_COMPLETED',
            details: {
              meetingId: minutes.meetingId,
              meetingStatus: meeting?.status,
            },
          },
        });
      }

      // Step 6: Publish
      const issuedAt = new Date();
      minutes.status = MeetingMinutesStatus.PUBLISHED;
      minutes.issuedBy = authUser.userId;
      minutes.issuedAt = issuedAt;
      const saved = await manager
        .getRepository(MeetingMinutesEntity)
        .save(minutes);

      return { saved, meeting };
    });

    // Step 7: Audit log (outside transaction, best-effort)
    await this.auditLogsService.logEntityChange({
      userId: authUser.userId,
      actionType: 'meeting_minutes_issued',
      entityType: 'meeting_minutes',
      entityId: minutesId,
      oldValueJson: { status: MeetingMinutesStatus.DRAFT },
      newValueJson: {
        status: MeetingMinutesStatus.PUBLISHED,
        issuedBy: authUser.userId,
        issuedAt: result.saved.issuedAt,
      },
    });

    // Step 8: Query participants for notification (outside transaction)
    let notifiedParticipantCount = 0;
    try {
      const participants = await this.dataSource
        .getRepository(MeetingParticipantEntity)
        .find({ where: { meetingId: result.saved.meetingId } });

      const recipientUserIds = participants
        .map((p) => p.userId)
        .filter((uid) => uid !== authUser.userId);

      if (recipientUserIds.length > 0) {
        await this.dataSource.getRepository(NotificationEntity).insert({
          notificationType: NotificationType.MINUTES_DISTRIBUTION,
          channel: NotificationChannel.IN_APP,
          subject: 'Bien ban hop da duoc ban hanh chinh thuc',
          content: `Bien ban hop "${result.saved.title}" da duoc ban hanh chinh thuc.`,
          relatedEntityType: 'meeting_minutes',
          relatedEntityId: minutesId,
          recipientScope: 'user_list',
          recipientUserIdsJson: recipientUserIds,
          createdBy: authUser.userId,
        });
        notifiedParticipantCount = recipientUserIds.length;
      }
    } catch (e) {
      this.logger.warn(
        'Failed to send minutes_distribution notification',
        e instanceof Error ? e.message : undefined,
      );
    }

    return new IssueMinutesResponseDto({
      id: result.saved.id,
      meetingId: result.saved.meetingId,
      title: result.saved.title,
      status: result.saved.status,
      versionNo: result.saved.versionNo,
      issuedBy: result.saved.issuedBy!,
      issuedAt: result.saved.issuedAt!,
      updatedAt: result.saved.updatedAt,
      notifiedParticipantCount,
    });
  }

  /* ================================================
     Share Minutes (feat-share-meeting-minutes)
     ================================================ */

  /**
   * Load biên bản + meeting và enforce ownership-or-admin cho các thao tác quản
   * lý share (grant/revoke/list). Trả về minutes + meeting để caller dùng tiếp.
   * KHÔNG kiểm tra status ở đây — mỗi caller tự quyết (grant/revoke cần published,
   * list không cần).
   */
  private async loadMinutesForShareManagement(
    minutesId: string,
    authUserId: string,
  ): Promise<{ minutes: MeetingMinutesEntity; meeting: MeetingEntity | null }> {
    const minutes = await this.dataSource
      .getRepository(MeetingMinutesEntity)
      .findOne({ where: { id: minutesId } });
    if (!minutes || minutes.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Bien ban hop khong ton tai hoac da bi xoa',
        error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
      });
    }

    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({ where: { id: minutes.meetingId } });

    const { roles } =
      await this.authzRepo.getEffectiveRolesAndPermissions(authUserId);
    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );
    if (!isAdmin) {
      const isOwner =
        minutes.preparedBy === authUserId || meeting?.hostId === authUserId;
      if (!isOwner) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong co quyen quan ly chia se bien ban nay',
          error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
        });
      }
    }

    return { minutes, meeting };
  }

  /**
   * Grant quyền xem 1 biên bản published cho 1 user nội bộ active bất kỳ.
   * FR-001, FR-005, FR-006, FR-025.
   */
  async shareMinutes(
    minutesId: string,
    dto: CreateMinutesShareDto,
    authUser: MinutesAuthUser,
  ): Promise<MinutesShareResponseDto> {
    const { minutes } = await this.loadMinutesForShareManagement(
      minutesId,
      authUser.userId,
    );

    // Chỉ share được khi published (FR-010)
    if (minutes.status !== MeetingMinutesStatus.PUBLISHED) {
      throw new ConflictException({
        success: false,
        message: 'Chi co the chia se bien ban da duoc ban hanh (published)',
        error: {
          code: 'MINUTES_NOT_PUBLISHED',
          details: { minutesId, currentStatus: minutes.status },
        },
      });
    }

    // Validate target user (FR-016, FR-017)
    const targetUser = await this.dataSource
      .getRepository(UserEntity)
      .findOne({ where: { id: dto.userId } });
    if (!targetUser || targetUser.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Nguoi dung duoc chia se khong ton tai',
        error: { code: 'USER_NOT_FOUND', details: { userId: dto.userId } },
      });
    }
    if (targetUser.accountStatus !== AccountStatus.ACTIVE) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Nguoi dung duoc chia se khong o trang thai hoat dong',
        error: {
          code: 'USER_INACTIVE',
          details: {
            userId: dto.userId,
            accountStatus: targetUser.accountStatus,
          },
        },
      });
    }

    // Insert — dựa vào UNIQUE constraint để chống race (FR-024, mục 9.2)
    const shareRepo = this.dataSource.getRepository(MeetingMinutesShareEntity);
    let saved: MeetingMinutesShareEntity;
    try {
      saved = await shareRepo.save(
        shareRepo.create({
          minutesId,
          userId: dto.userId,
          grantedBy: authUser.userId,
        }),
      );
    } catch (e: unknown) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException({
          success: false,
          message: 'Bien ban da duoc chia se cho nguoi dung nay',
          error: {
            code: 'ALREADY_SHARED',
            details: { minutesId, userId: dto.userId },
          },
        });
      }
      throw e;
    }

    await this.auditLogsService.logAction({
      userId: authUser.userId,
      actionType: 'meeting_minutes_shared',
      entityType: 'meeting_minutes',
      entityId: minutesId,
      metadataJson: { targetUserId: dto.userId, grantedBy: authUser.userId },
    });

    return new MinutesShareResponseDto({
      id: saved.id,
      minutesId,
      userId: dto.userId,
      userFullName: targetUser.fullName,
      grantedBy: authUser.userId,
      grantedAt: saved.grantedAt,
    });
  }

  /**
   * Thu hồi (hard-delete) 1 lượt share. FR-003, FR-007, FR-008, FR-019.
   */
  async unshareMinutes(
    minutesId: string,
    targetUserId: string,
    authUser: MinutesAuthUser,
  ): Promise<UnshareMinutesResponseDto> {
    const { minutes } = await this.loadMinutesForShareManagement(
      minutesId,
      authUser.userId,
    );

    if (minutes.status !== MeetingMinutesStatus.PUBLISHED) {
      throw new ConflictException({
        success: false,
        message: 'Chi co the thu hoi chia se khi bien ban dang published',
        error: {
          code: 'MINUTES_NOT_PUBLISHED',
          details: { minutesId, currentStatus: minutes.status },
        },
      });
    }

    const result = await this.dataSource
      .getRepository(MeetingMinutesShareEntity)
      .delete({ minutesId, userId: targetUserId });

    if (!result.affected) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay ban ghi chia se cho nguoi dung nay',
        error: {
          code: 'SHARE_NOT_FOUND',
          details: { minutesId, userId: targetUserId },
        },
      });
    }

    await this.auditLogsService.logAction({
      userId: authUser.userId,
      actionType: 'meeting_minutes_unshared',
      entityType: 'meeting_minutes',
      entityId: minutesId,
      metadataJson: { targetUserId, revokedBy: authUser.userId },
    });

    return new UnshareMinutesResponseDto({
      minutesId,
      userId: targetUserId,
      revoked: true,
    });
  }

  /**
   * Danh sách user đang được share (kèm tên/email). FR-004.
   * KHÔNG chặn theo status (list được cả khi archived — mục 7.3 plan).
   */
  async listMinutesShares(
    minutesId: string,
    authUser: MinutesAuthUser,
  ): Promise<MinutesShareListResponseDto> {
    await this.loadMinutesForShareManagement(minutesId, authUser.userId);

    const rows = await this.dataSource
      .getRepository(MeetingMinutesShareEntity)
      .createQueryBuilder('share')
      .leftJoin('share.user', 'targetUser')
      .leftJoin('share.grantedByUser', 'granter')
      .where('share.minutesId = :minutesId', { minutesId })
      .select([
        'share.id',
        'share.userId',
        'share.grantedBy',
        'share.grantedAt',
        'targetUser.fullName',
        'targetUser.email',
        'granter.fullName',
      ])
      .orderBy('share.grantedAt', 'DESC')
      .getRawAndEntities();

    const shares = rows.entities.map((share, idx) => {
      const raw = rows.raw[idx] as Record<string, unknown>;
      return new MinutesShareListItemDto({
        id: share.id,
        userId: share.userId,
        userFullName: (raw['targetUser_full_name'] as string) ?? '',
        userEmail: (raw['targetUser_email'] as string) ?? '',
        grantedBy: share.grantedBy,
        grantedByName: (raw['granter_full_name'] as string) ?? '',
        grantedAt: share.grantedAt,
      });
    });

    return new MinutesShareListResponseDto({ minutesId, shares });
  }

  /** Postgres unique_violation = SQLSTATE 23505. */
  private isUniqueViolation(e: unknown): boolean {
    return (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code?: string }).code === '23505'
    );
  }

  async searchMinutesByPerson(
    dto: SearchMinutesByPersonQueryDto,
    authUser: MinutesAuthUser,
  ): Promise<{
    items: MinutesListItemDto[];
    total: number;
    page: number;
    limit: number;
    person: PersonSummaryDto;
  }> {
    const page = Math.max(1, dto.page ?? 1);
    const limit = Math.min(20, Math.max(1, dto.limit ?? 20));
    const skip = (page - 1) * limit;

    const targetUser = await this.dataSource.getRepository(UserEntity).findOne({
      where: { id: dto.userId, deletedAt: IsNull() },
    });
    if (!targetUser) {
      throw new NotFoundException({
        success: false,
        message: 'Nhan su khong ton tai hoac da bi xoa',
        error: { code: 'USER_NOT_FOUND', details: { userId: dto.userId } },
      });
    }

    const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
      authUser.userId,
    );
    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );

    let managedDepartmentIds: string[] = [];
    if (!isAdmin) {
      const depts = (await this.dataSource
        .getRepository('DepartmentEntity')
        .find({
          where: { managerUserId: authUser.userId, deletedAt: null },
        })) as Array<{ id: string }>;
      managedDepartmentIds = depts.map((d) => d.id);
      if (managedDepartmentIds.length === 0) {
        return {
          items: [],
          total: 0,
          page,
          limit,
          person: new PersonSummaryDto({
            id: targetUser.id,
            fullName: targetUser.fullName ?? '',
            email: targetUser.email ?? '',
          }),
        };
      }
    }

    const qb = this.dataSource
      .getRepository(MeetingMinutesEntity)
      .createQueryBuilder('minutes')
      .leftJoin('minutes.meeting', 'meeting')
      .leftJoin('meeting.host', 'host')
      .leftJoin('meeting.organizer', 'organizer')
      .select([
        'minutes.id',
        'minutes.title',
        'minutes.status',
        'minutes.versionNo',
        'minutes.createdAt',
        'minutes.preparedBy',
        'minutes.aiSummaryJson',
        'meeting.id',
        'meeting.title',
        'meeting.actualStartTime',
        'meeting.actualEndTime',
        'meeting.meetingMode',
        'meeting.hostId',
        'meeting.roomId',
        'host.id',
        'host.fullName',
        'host.email',
      ])
      .where('minutes.deletedAt IS NULL')
      .andWhere(
        new Brackets((sub) => {
          sub
            .where('minutes.preparedBy = :targetUserId', {
              targetUserId: dto.userId,
            })
            .orWhere(
              'EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = meeting.id AND mp.user_id = :targetUserId2)',
              { targetUserId2: dto.userId },
            );
        }),
      );

    if (isAdmin) {
      qb.andWhere("minutes.status IN ('draft', 'published', 'archived')");
    } else {
      qb.andWhere("minutes.status IN ('published', 'archived')");
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('host.departmentId IN (:...deptIds)', {
              deptIds: managedDepartmentIds,
            })
            .orWhere(
              'meeting.hostId IS NULL AND organizer.departmentId IN (:...deptIds)',
              { deptIds: managedDepartmentIds },
            );
        }),
      );
    }

    qb.orderBy('meeting.actualStartTime', 'DESC').skip(skip).take(limit);
    const [items, total] = await qb.getManyAndCount();

    const roomIds = Array.from(
      new Set(items.map((m) => m.meeting?.roomId).filter(Boolean)),
    ) as string[];
    const rooms = roomIds.length
      ? await this.dataSource
          .getRepository(RoomEntity)
          .find({ where: { id: In(roomIds) } })
      : [];
    const roomById = new Map(rooms.map((r) => [r.id, r]));

    const listItems = items.map((minutes: MeetingMinutesEntity) => {
      const meeting = minutes.meeting;
      const roomEntity = meeting?.roomId
        ? roomById.get(meeting.roomId)
        : undefined;
      const hostEntity = meeting?.host ?? null;
      return new MinutesListItemDto(
        minutes.id,
        minutes.title,
        minutes.status,
        minutes.versionNo,
        minutes.createdAt,
        new MinutesMeetingSummaryDto(
          meeting.id,
          meeting.title,
          meeting.actualStartTime,
          meeting.actualEndTime,
          meeting.meetingMode,
          roomEntity
            ? new RoomSummaryDto(roomEntity.id, roomEntity.roomName)
            : null,
        ),
        hostEntity
          ? new UserSummaryDto(
              hostEntity.id,
              hostEntity.fullName,
              hostEntity.email,
            )
          : null,
        minutes.aiSummaryJson != null,
      );
    });

    return {
      items: listItems,
      total,
      page,
      limit,
      person: new PersonSummaryDto({
        id: targetUser.id,
        fullName: targetUser.fullName ?? '',
        email: targetUser.email ?? '',
      }),
    };
  }
}
