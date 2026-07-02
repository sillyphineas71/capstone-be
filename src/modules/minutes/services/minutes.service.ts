import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DataSource, IsNull, In, Brackets } from 'typeorm';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../../meetings/entities/meeting-participant.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
  MeetingMinutesVisibilityLevel,
} from '../entities/meeting-minutes.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { CreateDraftMinutesDto } from '../dto/create-draft-minutes.dto.js';
import {
  DraftMinutesResponseDto,
  MinutesAttendeeSnapshot,
} from '../dto/draft-minutes-response.dto.js';
import { MinutesQueryDto } from '../dto/minutes-query.dto.js';
import { MinutesListItemDto } from '../dto/minutes-list-item.dto.js';
import { MinutesMeetingSummaryDto } from '../dto/minutes-meeting-summary.dto.js';
import { RoomSummaryDto } from '../../meetings/dto/room-summary.dto.js';
import { UserSummaryDto } from '../../meetings/dto/user-summary.dto.js';

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

const LIST_MAX_LIMIT = 20; // BR2 (UC-MKM-02): tối đa 20 bản ghi/trang

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
  ) {}

  async createDraft(
    meetingId: string,
    dto: CreateDraftMinutesDto,
    authUser: MinutesAuthUser,
  ): Promise<DraftMinutesResponseDto> {
    const result = await this.dataSource.transaction(
      async (manager): Promise<CreateDraftTransactionResult> => {
        // Step 1: Load + lock meeting (tránh race condition tạo trùng minutes)
        const meeting = await manager
          .getRepository(MeetingEntity)
          .createQueryBuilder('meeting')
          .setLock('pessimistic_write')
          .where('meeting.id = :meetingId', { meetingId })
          .getOne();

        if (!meeting || meeting.deletedAt) {
          throw new NotFoundException({
            success: false,
            message: 'Cuộc họp không tồn tại hoặc đã bị xóa',
            error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
          });
        }

        // Step 2: Meeting phải có Host được gán
        if (!meeting.hostId) {
          throw new ConflictException({
            success: false,
            message: 'Cuộc họp chưa được gán Host, không thể tạo biên bản họp',
            error: {
              code: 'MEETING_HOST_NOT_ASSIGNED',
              details: { meetingId },
            },
          });
        }

        // Step 3: Chỉ Host của cuộc họp mới được tạo (BR1)
        if (meeting.hostId !== authUser.userId) {
          throw new ForbiddenException({
            success: false,
            message: 'Chỉ Host của cuộc họp mới được tạo biên bản họp',
            error: { code: 'NOT_MEETING_HOST', details: { meetingId } },
          });
        }

        // Step 4: Meeting status guard — cho phép tạo khi đang diễn ra hoặc đã kết thúc
        if (meeting.status === MeetingStatus.CANCELLED) {
          throw new ConflictException({
            success: false,
            message: 'Cuộc họp đã bị hủy, không thể tạo biên bản họp',
            error: { code: 'MEETING_CANCELLED', details: { meetingId } },
          });
        }

        if (!MEETING_STATUSES_ALLOWED_FOR_MINUTES.includes(meeting.status)) {
          throw new ConflictException({
            success: false,
            message: 'Cuộc họp chưa bắt đầu, chưa thể tạo biên bản họp',
            error: {
              code: 'MEETING_NOT_STARTED',
              details: { meetingId, currentStatus: meeting.status },
            },
          });
        }

        // Step 5: Chống tạo trùng — tối đa 1 minutes active per meeting
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

        // Step 6: Snapshot danh sách tham dự tại thời điểm tạo (BR2 — khóa cứng)
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

        // Step 7: Tạo bản ghi draft
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

    // Audit log ngoài transaction — AuditLogsService tự fail-safe, không chặn business flow
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

      // Scope theo role (BR phân quyền UC-MKM-02)
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

      // status filter (client) — AND thêm vào scope, không thay thế
      if (queryDto.status && queryDto.status !== 'all') {
        qb.andWhere('minutes.status = :clientStatus', {
          clientStatus: queryDto.status,
        });
      }

      // roomId filter
      if (queryDto.roomId) {
        qb.andWhere('meeting.roomId = :roomId', { roomId: queryDto.roomId });
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

      // MeetingEntity không có relation `room` (chỉ có cột roomId) — batch load
      // riêng để tránh N+1 và tránh lỗi hydrate của raw entity join (xem
      // research.md mục "Rủi ro & quyết định thiết kế").
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
        message: 'Lỗi hệ thống',
        error: { code: 'INTERNAL_ERROR' },
      });
    }
  }
}
