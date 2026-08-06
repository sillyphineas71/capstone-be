import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  BadRequestException,
  BadGatewayException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  Not,
  MoreThan,
  MoreThanOrEqual,
  LessThanOrEqual,
  QueryFailedError,
} from 'typeorm';

import {
  MeetingEntity,
  MeetingStatus,
  MeetingType,
  MeetingMode,
  MeetingVisibilityLevel,
} from '../entities/meeting.entity.js';
import {
  MeetingRequestEntity,
  MeetingRequestType,
  ApprovalMode,
  ApprovalStatus,
  ConflictCheckStatus,
} from '../entities/meeting-request.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
  InvitationStatus,
  ParticipantAttendanceStatus,
} from '../entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../entities/meeting-external-participant.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../entities/meeting-event.entity.js';
import {
  MeetingAgendaEntity,
  AgendaStatus,
} from '../entities/meeting-agenda.entity.js';
import { RoomEntity, RoomStatus } from '../../rooms/entities/room.entity.js';
import { RoomEventEntity } from '../../rooms/entities/room-event.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
  BookingType,
} from '../../rooms/entities/room-booking.entity.js';
import {
  NotificationEntity,
  NotificationType,
  NotificationChannel,
  NotificationPriority,
  NotificationDeliveryStatus,
} from '../../notifications/entities/notification.entity.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { FaceProvisioningService } from '../../face-access/services/face-provisioning.service.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import {
  UserEntity,
  AccountStatus,
} from '../../accounts/entities/user.entity.js';
import { UserRoleEntity } from '../../accounts/entities/user-role.entity.js';
import { RoleEntity } from '../../accounts/entities/role.entity.js';
import { PermissionEntity } from '../../accounts/entities/permission.entity.js';

import { CreateMeetingDto } from '../dto/create-meeting.dto.js';
import { CreateMeetingResponseDto } from '../dto/create-meeting-response.dto.js';
import { ExternalParticipantDto } from '../dto/external-participant.dto.js';
import { UpdateMeetingTimeDto } from '../dto/update-meeting-time.dto.js';
import { UpdateMeetingRoomDto } from '../dto/update-meeting-room.dto.js';
import type { UpdateMeetingRoomResponseDto } from '../dto/update-meeting-room-response.dto.js';
import type { CancelMeetingResponseDto } from '../dto/cancel-meeting-response.dto.js';
import type {
  AvailableRoomDto,
  CapacityWarning,
} from '../dto/available-room.dto.js';
import {
  BackgroundJobEntity,
  BackgroundJobType,
  BackgroundJobStatus,
} from '../../administration/entities/background-job.entity.js';
import {
  MediaFileEntity,
  MediaFileType,
  StorageProvider,
} from '../../recording/entities/media-file.entity.js';
import { StorageService } from '../../storage/storage.service.js';
import { RecordingConfigEntity } from '../../recording/entities/recording-config.entity.js';
import { AddInternalParticipantDto } from '../dto/add-internal-participant.dto.js';
import { RemoveParticipantParamsDto } from '../dto/remove-participant-params.dto.js';
import { RemoveParticipantBodyDto } from '../dto/remove-participant-body.dto.js';
import { RemoveParticipantResponseDto } from '../dto/remove-participant-response.dto.js';
import { AddExternalParticipantDto } from '../dto/add-external-participant.dto.js';
import type { IAddExternalParticipantResponse } from '../dto/add-external-participant-response.dto.js';
import { RemoveScope } from '../types/remove-scope.type.js';
import type { IAddInternalParticipantResponse } from '../dto/add-internal-participant-response.dto.js';
import { MyScheduleQueryDto } from '../dto/my-schedule-query.dto.js';
import { RemoveExternalParticipantBodyDto } from '../dto/remove-external-participant-body.dto.js';
import { RemoveExternalParticipantResponseDto } from '../dto/remove-external-participant-response.dto.js';
import { ScheduleResponseDto } from '../dto/schedule-response.dto.js';
import { ScheduleEventDto } from '../dto/schedule-event.dto.js';
import { ScheduleRoomDto } from '../dto/schedule-room.dto.js';
import { ScheduleRangeDto } from '../dto/schedule-range.dto.js';
import {
  MyScheduleDetailDto,
  DetailMeetingDto,
  DetailRoomDto,
  DetailUserDto,
  DetailParticipantDto,
} from '../dto/my-schedule-detail.dto.js';
import {
  DetailExternalParticipantDto,
  DetailAgendaDto,
  DetailAttachmentDto,
  DetailRecordingConfigDto,
} from '../dto/my-schedule-detail.dto.js';
import { MeetingRequestQueryDto } from '../dto/meeting-request-query.dto.js';
import { MeetingRequestListItemDto } from '../dto/meeting-request-list-item.dto.js';
import { UserSummaryDto } from '../dto/user-summary.dto.js';
import { RoomSummaryDto } from '../dto/room-summary.dto.js';

import { WarningTokenUtil, WarningItem } from '../utils/warning-token.util.js';
import { AgendaItemDto } from '../dto/agenda-item.dto.js';
import { ReplaceAgendaDto } from '../dto/replace-agenda.dto.js';
import { UpdateAgendaItemDto } from '../dto/update-agenda-item.dto.js';
import {
  AgendaItemResponseDto,
  AgendaListResponseDto,
  ReplaceAgendaResponseDto,
  AgendaItemUpdateResponseDto,
  DeleteAgendaItemResponseDto,
} from '../dto/agenda-response.dto.js';
import {
  AgendaAttachmentDto,
  AgendaAttachmentUploadResponseDto,
  DeleteAgendaAttachmentResponseDto,
} from '../dto/agenda-attachment.dto.js';
import {
  AGENDA_ATTACHMENT_MAX_BYTES_DEFAULT,
  AGENDA_ATTACHMENT_MAX_COUNT_DEFAULT,
  AGENDA_ATTACHMENT_ALLOWED_MIME_TYPES,
  AGENDA_ATTACHMENT_MIME_TO_EXTENSIONS,
} from '../constants/agenda-attachment.constants.js';
export interface AuthUser {
  userId: string;
  jti?: string;
  exp?: number;
}

export interface ClientContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface UploadedAgendaAttachmentFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface UpdateMeetingTimeResponse {
  meetingId: string;
  oldStartTime: string;
  oldEndTime: string;
  newStartTime: string;
  newEndTime: string;
  oldRoomId: string | null;
  newRoomId: string | null;
  bookingId: string;
  notificationStatus: string;
  updatedAt: string;
  // Nghiệp vụ duyệt lại (dev-branch): true khi meeting đang SCHEDULED nên thay
  // đổi được ghi thành MeetingRequest PENDING chờ Manager duyệt, CHƯA áp dụng
  // vào meeting — newStartTime/newEndTime/newRoomId ở trên khi đó là giá trị
  // ĐANG YÊU CẦU, không phải giá trị đã áp dụng.
  pendingApproval: boolean;
  requestId?: string;
}

interface ConflictResult {
  hasConflict: boolean;
  conflictingBookingId: string | null;
}

interface ParticipantConflictResult {
  conflicts: Array<{
    userId: string;
    busyFrom: string;
    busyTo: string;
  }>;
  hasConflict: boolean;
  conflictCount: number;
}

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly warningTokenUtil: WarningTokenUtil,
    private readonly notificationsService: NotificationsService,
    private readonly authzRepo: AuthzReadRepository,
    private readonly faceProvisioningService: FaceProvisioningService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  async getRoomAvailability(
    roomId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<ConflictResult> {
    const conflicting = await this.dataSource
      .getRepository(RoomBookingEntity)
      .findOne({
        where: {
          roomId,
          status: In([
            RoomBookingStatus.PENDING,
            RoomBookingStatus.APPROVED,
            RoomBookingStatus.ACTIVE,
          ]),
          reservedStartTime: LessThanOrEqual(endTime),
          reservedEndTime: MoreThanOrEqual(startTime),
        },
      });

    return {
      hasConflict: !!conflicting,
      conflictingBookingId: conflicting?.id ?? null,
    };
  }

  /** yyyyMMdd theo giờ máy chủ — dùng chung cho mã họp và mã booking. */
  private todayStamp(): string {
    const today = new Date();
    return (
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, '0') +
      String(today.getDate()).padStart(2, '0')
    );
  }

  /** Số thứ tự lớn nhất ĐÃ CẤP trong ngày, đọc từ chính mã đã tồn tại. */
  private maxSeqOf(codes: string[], prefix: string): number {
    return codes.reduce((mx, code) => {
      const n = parseInt(code.slice(prefix.length), 10);
      return Number.isFinite(n) && n > mx ? n : mx;
    }, 0);
  }

  /**
   * Sinh mã cuộc họp duy nhất.
   *
   * ⚠ KHÔNG dùng `count(...) + 1` như bản cũ: `count` đếm bản ghi ĐANG SỐNG, trong khi
   * `ux_meetings_code` vẫn bị chiếm bởi bản ghi soft-delete (MeetingEntity có
   * @DeleteDateColumn). Xoá 1 họp → count tụt 1 → sinh lại đúng mã đã cấp → 23505.
   * Hai request đồng thời cũng cùng đọc một `count` → cùng seq.
   *
   * Cách mới: lấy MAX seq đã cấp (kể cả bản soft-delete qua `.withDeleted()`), +1, rồi
   * KIỂM TỒN TẠI trước khi trả; đụng thì tăng tiếp, tối đa 10 lần. Fallback theo timestamp.
   */
  async generateMeetingCode(): Promise<string> {
    const prefix = `MT-${this.todayStamp()}-`;
    const repo = this.dataSource.getRepository(MeetingEntity);

    for (let attempt = 0; attempt < 10; attempt++) {
      const rows = await repo
        .createQueryBuilder('m')
        .withDeleted() // bản soft-delete VẪN chiếm ux_meetings_code
        .select('m.meetingCode', 'code')
        .where('m.meetingCode LIKE :prefix', { prefix: `${prefix}%` })
        .getRawMany<{ code: string }>();

      const next = this.maxSeqOf(
        rows.map((r) => r.code),
        prefix,
      );
      const code = `${prefix}${String(next + 1 + attempt).padStart(3, '0')}`;

      const exists = await repo
        .createQueryBuilder('m')
        .withDeleted()
        .where('m.meetingCode = :code', { code })
        .getCount();
      if (exists === 0) return code;
    }

    // Không bao giờ trùng: 6 số cuối epoch ms.
    return `${prefix}${Date.now().toString().slice(-6)}`;
  }

  /**
   * Sinh mã booking duy nhất — cùng lỗi `count + 1` như generateMeetingCode.
   * RoomBookingEntity KHÔNG có soft-delete nên không cần `.withDeleted()`, nhưng vẫn
   * giữ vòng kiểm-tồn-tại + retry để chống race giữa 2 request đồng thời.
   */
  async generateBookingCode(): Promise<string> {
    const prefix = `BK-${this.todayStamp()}-`;
    const repo = this.dataSource.getRepository(RoomBookingEntity);

    for (let attempt = 0; attempt < 10; attempt++) {
      const rows = await repo
        .createQueryBuilder('b')
        .select('b.bookingCode', 'code')
        .where('b.bookingCode LIKE :prefix', { prefix: `${prefix}%` })
        .getRawMany<{ code: string }>();

      const next = this.maxSeqOf(
        rows.map((r) => r.code),
        prefix,
      );
      const code = `${prefix}${String(next + 1 + attempt).padStart(3, '0')}`;

      const exists = await repo
        .createQueryBuilder('b')
        .where('b.bookingCode = :code', { code })
        .getCount();
      if (exists === 0) return code;
    }

    return `${prefix}${Date.now().toString().slice(-6)}`;
  }

  /**
   * Sinh mã meeting request duy nhất — ĐỘC LẬP với meetingCode.
   *
   * ⚠ Bản cũ dùng lại `meetingCode` làm `requestCode` (chỉ kiểm tồn tại trong
   * `meetings.meeting_code`, không kiểm trong `meeting_requests.request_code`).
   * `meeting_requests` không bao giờ bị xoá theo meeting (FK `SET NULL`), nên một
   * mã đã "trống" ở bảng `meetings` vẫn có thể còn bị chiếm ở `meeting_requests` →
   * 23505 trên `ux_meeting_requests_code` ngay ở lần tạo đầu tiên trong ngày.
   * Nay sinh mã riêng theo đúng pattern MAX-seq + kiểm tồn tại như `generateMeetingCode`.
   */
  async generateRequestCode(prefix: string): Promise<string> {
    const fullPrefix = `${prefix}-${this.todayStamp()}-`;
    const repo = this.dataSource.getRepository(MeetingRequestEntity);

    for (let attempt = 0; attempt < 10; attempt++) {
      const rows = await repo
        .createQueryBuilder('r')
        .select('r.requestCode', 'code')
        .where('r.requestCode LIKE :prefix', { prefix: `${fullPrefix}%` })
        .getRawMany<{ code: string }>();

      const next = this.maxSeqOf(
        rows.map((r) => r.code),
        fullPrefix,
      );
      const code = `${fullPrefix}${String(next + 1 + attempt).padStart(3, '0')}`;

      const exists = await repo
        .createQueryBuilder('r')
        .where('r.requestCode = :code', { code })
        .getCount();
      if (exists === 0) return code;
    }

    return `${fullPrefix}${Date.now().toString().slice(-6)}`;
  }

  /**
   * True khi lỗi là unique-violation trên mã họp/mã booking/mã request — CHỈ những
   * lỗi này mới đáng retry. Lỗi nghiệp vụ (ROOM_CONFLICT, CAPACITY_EXCEEDED...) phải
   * ném nguyên.
   */
  private isCodeConflict(error: unknown): boolean {
    const driverError = (error as { driverError?: { code?: string } })
      ?.driverError;
    if (driverError?.code !== '23505') return false;
    const constraint =
      (error as { driverError?: { constraint?: string } })?.driverError
        ?.constraint ?? '';
    const message = (error as Error)?.message ?? '';
    return /meetings_code|room_bookings_code|booking_code|meeting_code|meeting_requests_code|request_code/i.test(
      `${constraint} ${message}`,
    );
  }

  async checkParticipantConflicts(
    userIds: string[],
    startTime: Date,
    endTime: Date,
  ): Promise<ParticipantConflictResult> {
    if (!userIds.length) {
      return { conflicts: [], hasConflict: false, conflictCount: 0 };
    }

    const conflicts = await this.dataSource
      .getRepository(MeetingParticipantEntity)
      .createQueryBuilder('mp')
      .innerJoin('mp.meeting', 'm')
      .select(['mp.userId', 'm.startTime', 'm.endTime'])
      .where('mp.userId IN (:...userIds)', { userIds })
      .andWhere('m.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [MeetingStatus.CANCELLED, MeetingStatus.COMPLETED],
      })
      .andWhere('m.startTime < :endTime', { endTime })
      .andWhere('m.endTime > :startTime', { startTime })
      .andWhere('m.deletedAt IS NULL')
      .getMany();

    return {
      conflicts: this.groupAndMergeConflictsByUser(conflicts),
      hasConflict: conflicts.length > 0,
      conflictCount: new Set(conflicts.map((mp) => mp.userId)).size,
    };
  }

  private groupAndMergeConflictsByUser(
    participants: Array<{
      userId: string;
      meeting: { startTime: Date; endTime: Date };
    }>,
  ): ParticipantConflictResult['conflicts'] {
    const userMap = new Map<string, { busyFrom: Date; busyTo: Date }[]>();

    for (const mp of participants) {
      const meeting = (
        mp as unknown as { meeting: { startTime: Date; endTime: Date } }
      ).meeting;
      if (!userMap.has(mp.userId)) {
        userMap.set(mp.userId, []);
      }
      userMap
        .get(mp.userId)!
        .push({ busyFrom: meeting.startTime, busyTo: meeting.endTime });
    }

    const result: ParticipantConflictResult['conflicts'] = [];

    for (const [userId, slots] of userMap) {
      slots.sort((a, b) => a.busyFrom.getTime() - b.busyFrom.getTime());

      const merged: { busyFrom: Date; busyTo: Date }[] = [];
      let current = { ...slots[0] };

      for (let i = 1; i < slots.length; i++) {
        const next = slots[i];
        if (current.busyTo.getTime() >= next.busyFrom.getTime()) {
          if (next.busyTo.getTime() > current.busyTo.getTime()) {
            current.busyTo = next.busyTo;
          }
        } else {
          merged.push(current);
          current = { ...next };
        }
      }
      merged.push(current);

      result.push({
        userId,
        busyFrom: merged[0].busyFrom.toISOString(),
        busyTo: merged[merged.length - 1].busyTo.toISOString(),
      });
    }

    return result;
  }

  async getAvailableRooms(
    startTime: Date,
    endTime: Date,
    minCapacity?: number,
  ): Promise<RoomEntity[]> {
    const queryBuilder = this.dataSource
      .getRepository(RoomEntity)
      .createQueryBuilder('room')
      .where('room.isActive = :isActive', { isActive: true })
      .andWhere('room.currentStatus != :inactiveStatus', {
        inactiveStatus: 'inactive',
      });

    if (minCapacity) {
      queryBuilder.andWhere('room.capacity >= :minCapacity', { minCapacity });
    }

    const allRooms = await queryBuilder.getMany();

    const bookedRoomIds = await this.dataSource
      .getRepository(RoomBookingEntity)
      .createQueryBuilder('rb')
      .select('rb.roomId')
      .where('rb.status IN (:...statuses)', {
        statuses: [
          RoomBookingStatus.PENDING,
          RoomBookingStatus.APPROVED,
          RoomBookingStatus.ACTIVE,
        ],
      })
      .andWhere('rb.reservedStartTime < :endTime', { endTime })
      .andWhere('rb.reservedEndTime > :startTime', { startTime })
      .getRawMany()
      .then((rows) => rows.map((r: { rb_room_id: string }) => r.rb_room_id));

    return allRooms.filter((room) => !bookedRoomIds.includes(room.id));
  }

  async create(
    dto: CreateMeetingDto,
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<CreateMeetingResponseDto> {
    const hostId = dto.hostId || authUser.userId;
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);

    if (endTime <= startTime) {
      throw new BadRequestException({
        success: false,
        message: 'Thời gian kết thúc phải sau thời gian bắt đầu',
        error: { code: 'VALIDATION_ERROR', details: { field: 'endTime' } },
      });
    }

    if (startTime.getTime() <= Date.now()) {
      throw new BadRequestException({
        success: false,
        message: 'Thời gian bắt đầu không được nằm trong quá khứ',
        error: { code: 'VALIDATION_ERROR', details: { field: 'startTime' } },
      });
    }

    const room = await this.dataSource.getRepository(RoomEntity).findOne({
      where: { id: dto.roomId, isActive: true },
    });

    if (!room || room.currentStatus === 'inactive') {
      throw new NotFoundException({
        success: false,
        message: 'Phòng họp không tồn tại hoặc không khả dụng',
        error: { code: 'ROOM_NOT_FOUND', details: { roomId: dto.roomId } },
      });
    }

    if (hostId !== authUser.userId) {
      const hostUser = await this.dataSource.getRepository(UserEntity).findOne({
        where: { id: hostId, accountStatus: AccountStatus.ACTIVE },
      });
      if (!hostUser) {
        throw new NotFoundException({
          success: false,
          message: 'Người chủ trì không tồn tại hoặc không hoạt động',
          error: { code: 'RESOURCE_NOT_FOUND', details: { field: 'hostId' } },
        });
      }
    }

    const allParticipantIds = [...(dto.participantUserIds || [])];
    if (!allParticipantIds.includes(hostId)) {
      allParticipantIds.push(hostId);
    }
    const uniqueParticipantIds = [...new Set(allParticipantIds)];

    if (uniqueParticipantIds.length > 0) {
      const existingUsers = await this.dataSource
        .getRepository(UserEntity)
        .find({
          where: {
            id: In(uniqueParticipantIds),
            accountStatus: AccountStatus.ACTIVE,
          },
        });
      const existingIds = new Set(existingUsers.map((u) => u.id));
      const invalidIds = uniqueParticipantIds.filter(
        (id) => !existingIds.has(id),
      );
      if (invalidIds.length > 0) {
        throw new BadRequestException({
          success: false,
          message: 'Một số người tham dự không tồn tại hoặc không hoạt động',
          error: {
            code: 'VALIDATION_ERROR',
            details: { invalidParticipantIds: invalidIds },
          },
        });
      }
    }

    const roomConflict = await this.getRoomAvailability(
      dto.roomId,
      startTime,
      endTime,
    );
    if (roomConflict.hasConflict) {
      throw new ConflictException({
        success: false,
        message:
          'Phòng họp này vừa được đặt. Vui lòng chọn một phòng khác hoặc đổi khung giờ.',
        error: {
          code: 'ROOM_CONFLICT',
          details: { conflictingBookingId: roomConflict.conflictingBookingId },
        },
      });
    }

    const totalParticipants =
      uniqueParticipantIds.length + (dto.externalParticipants?.length || 0);
    const capacityOverride = dto.capacityOverrideConfirmed === true;

    if (totalParticipants > room.capacity && !capacityOverride) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Số lượng người tham dự vượt quá sức chứa của phòng',
        error: {
          code: 'CAPACITY_EXCEEDED',
          details: {
            roomCapacity: room.capacity,
            totalParticipants,
            capacityOverrideConfirmed: false,
          },
        },
      });
    }

    // `let` vì vòng retry bên dưới sẽ sinh lại khi đụng unique mã.
    let meetingCode = await this.generateMeetingCode();
    let bookingCode = await this.generateBookingCode();
    let requestCode = await this.generateRequestCode('MR');

    const participantConflictResult = await this.checkParticipantConflicts(
      uniqueParticipantIds.filter((id) => id !== hostId),
      startTime,
      endTime,
    );

    const approverIds = await this.resolveApproverIds();

    let meeting: MeetingEntity;
    let request: MeetingRequestEntity;
    let booking: RoomBookingEntity;

    // Phòng thủ lớp 2: dù generateMeetingCode đã kiểm tồn tại, vẫn còn khe race cực hẹp
    // giữa lúc kiểm và lúc INSERT. Đụng ux_meetings_code/ux_room_bookings_code → sinh mã
    // mới và thử lại (tối đa 3 lượt). MỌI lỗi khác ném nguyên, KHÔNG nuốt.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.dataSource.transaction(async (em) => {
          meeting = em.create(MeetingEntity, {
            meetingCode,
            title: dto.title,
            description: dto.description || null,
            organizerId: authUser.userId,
            hostId,
            roomId: dto.roomId,
            startTime,
            endTime,
            meetingType: (dto.meetingType as MeetingType) || MeetingType.NORMAL,
            meetingMode:
              (dto.meetingMode as MeetingMode) || MeetingMode.OFFLINE,
            status: MeetingStatus.PENDING_APPROVAL,
            visibilityLevel: 'internal' as any,
            timezone: 'Asia/Ho_Chi_Minh',
            expectedAttendeeCount: dto.expectedAttendeeCount || null,
            createdBy: authUser.userId,
          });
          await em.save(MeetingEntity, meeting);

          const participantIds = dto.participantUserIds || [];
          const internalParticipantsForRequest = participantIds.filter(
            (id) => id !== hostId,
          );

          request = em.create(MeetingRequestEntity, {
            requestCode,
            meetingId: meeting.id,
            requestType: MeetingRequestType.CREATE_MEETING,
            requestedBy: authUser.userId,
            targetRoomId: dto.roomId,
            requestedStartTime: startTime,
            requestedEndTime: endTime,
            approvalMode: ApprovalMode.MANUAL,
            approvalStatus: ApprovalStatus.PENDING,
            conflictCheckStatus:
              participantConflictResult.conflicts.length > 0
                ? ConflictCheckStatus.WARNING
                : ConflictCheckStatus.CLEAR,
            conflictSummaryJson:
              participantConflictResult.conflicts.length > 0
                ? { conflicts: participantConflictResult.conflicts }
                : null,
            requestPayloadJson: {
              title: dto.title,
              description: dto.description,
              hostId,
              roomId: dto.roomId,
              startTime: dto.startTime,
              endTime: dto.endTime,
              meetingType: dto.meetingType,
              meetingMode: dto.meetingMode,
              expectedAttendeeCount: dto.expectedAttendeeCount,
              capacityOverrideConfirmed: dto.capacityOverrideConfirmed,
              participantUserIds: dto.participantUserIds,
              externalParticipants: dto.externalParticipants,
            },
            notes: null,
          });
          await em.save(MeetingRequestEntity, request);

          booking = em.create(RoomBookingEntity, {
            bookingCode,
            meetingId: meeting.id,
            roomId: dto.roomId,
            bookingType: BookingType.SCHEDULED,
            reservedStartTime: startTime,
            reservedEndTime: endTime,
            status: RoomBookingStatus.PENDING,
            bookedBy: authUser.userId,
          });
          await em.save(RoomBookingEntity, booking);

          const participantRecords: MeetingParticipantEntity[] = [];
          const alreadyAdded = new Set<string>();

          if (!alreadyAdded.has(hostId)) {
            participantRecords.push(
              em.create(MeetingParticipantEntity, {
                meetingId: meeting.id,
                userId: hostId,
                participantRole: ParticipantRole.HOST,
                isRequired: true,
                attendanceRequired: true,
                invitationStatus: InvitationStatus.PENDING,
                attendanceStatus: ParticipantAttendanceStatus.NOT_CHECKED_IN,
                invitedBy: authUser.userId,
              }),
            );
            alreadyAdded.add(hostId);
          }

          for (const uid of participantIds) {
            if (!alreadyAdded.has(uid)) {
              participantRecords.push(
                em.create(MeetingParticipantEntity, {
                  meetingId: meeting.id,
                  userId: uid,
                  participantRole: ParticipantRole.ATTENDEE,
                  isRequired: true,
                  attendanceRequired: true,
                  invitationStatus: InvitationStatus.PENDING,
                  attendanceStatus: ParticipantAttendanceStatus.NOT_CHECKED_IN,
                  invitedBy: authUser.userId,
                }),
              );
              alreadyAdded.add(uid);
            }
          }

          if (participantRecords.length > 0) {
            await em.save(MeetingParticipantEntity, participantRecords);
          }

          if (dto.externalParticipants && dto.externalParticipants.length > 0) {
            const externalRecords = dto.externalParticipants.map(
              (ep: ExternalParticipantDto) =>
                em.create(MeetingExternalParticipantEntity, {
                  meetingId: meeting.id,
                  fullName: ep.fullName,
                  email: ep.email,
                  organizationName: ep.organization || null,
                  participantRole: 'attendee',
                  invitationStatus: 'pending',
                }),
            );
            await em.save(MeetingExternalParticipantEntity, externalRecords);
          }

          const event = em.create(MeetingEventEntity, {
            meetingId: meeting.id,
            eventType: MeetingEventType.MEETING_REQUEST_CREATED,
            actorUserId: authUser.userId,
            sourceType: MeetingEventSourceType.MANUAL,
            description: `Yêu cầu tạo cuộc họp "${dto.title}"`,
            newValueJson: {
              meetingId: meeting.id,
              meetingCode,
              status: MeetingStatus.PENDING_APPROVAL,
            } as any,
          });
          await em.save(MeetingEventEntity, event);

          const auditLog = em.create(AuditLogEntity, {
            userId: authUser.userId,
            actionType: 'create',
            entityType: 'meeting_request',
            entityId: request.id,
            metadataJson: { meetingId: meeting.id, bookingId: booking.id },
            ipAddress: clientContext.ipAddress || null,
            userAgent: clientContext.userAgent || null,
            severity: AuditLogSeverity.INFO,
          });
          await em.save(AuditLogEntity, auditLog);
        });
        break;
      } catch (error: unknown) {
        if (attempt < 2 && this.isCodeConflict(error)) {
          this.logger.warn(
            `Trùng mã khi tạo họp (lượt ${attempt + 1}) — sinh mã mới, thử lại.`,
          );
          meetingCode = await this.generateMeetingCode();
          bookingCode = await this.generateBookingCode();
          requestCode = await this.generateRequestCode('MR');
          continue;
        }
        this.logger.error(
          `Transaction failed for meeting creation: ${(error as Error).message}`,
          (error as Error).stack,
        );
        throw error;
      }
    }

    // Post-transaction: notify approvers (non-blocking, no rollback)
    if (approverIds.length > 0) {
      try {
        await this.notificationsService.createNotification({
          notificationType: NotificationType.MEETING_REQUEST_CREATED,
          channel: NotificationChannel.IN_APP,
          subject: `Y\u00ea\u0301u c\u00e2\u0300u ho\u0323p m\u01a1\u0301i: ${dto.title}`,
          content: `Ng\u01b0\u01a1\u0300i du\u0300ng ${authUser.userId} \u0111a\u0303 ta\u0323o y\u00eau c\u00e2\u0300u cu\u00f4\u0323c ho\u0323p "${dto.title}" ch\u01a1\u0300 ph\u00ea duy\u00ea\u0323t.`,
          relatedEntityType: 'meeting_request',
          relatedEntityId: request!.id,
          recipientScope: 'user_list',
          recipientUserIds: approverIds,
          createdBy: authUser.userId,
        });
      } catch (notifError) {
        this.logger.error(
          '[Create] Failed to send approver notification for meeting ' +
            meeting!.id +
            ': ' +
            (notifError as Error).message,
        );
      }
    }

    return new CreateMeetingResponseDto({
      id: meeting!.id,
      meetingCode,
      title: dto.title,
      status: MeetingStatus.PENDING_APPROVAL,
      approvalStatus: ApprovalStatus.PENDING,
      startTime,
      endTime,
      roomId: dto.roomId,
      roomName: room.roomName,
      organizerId: authUser.userId,
      hostId,
      participantCount:
        uniqueParticipantIds.length + (dto.externalParticipants?.length || 0),
      bookingStatus: RoomBookingStatus.PENDING,
      bookingCode,
      createdAt: meeting!.createdAt,
    });
  }

  // --- Shared notification helpers ---

  private async resolveUserEmails(
    userIds: string[],
    manager: any,
  ): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    try {
      const users = await manager.find(UserEntity, {
        where: { id: In(userIds) },
        select: { id: true, email: true },
      });
      return new Map(users.map((u: any) => [u.id, u.email]));
    } catch (err) {
      this.logger.error(
        '[resolveUserEmails] Failed: ' + (err as Error).message,
      );
      return new Map();
    }
  }

  async updateMeetingTime(
    meetingId: string,
    dto: UpdateMeetingTimeDto,
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<UpdateMeetingTimeResponse> {
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
      relations: { organizer: true },
    });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Cuộc họp không tồn tại hoặc đã bị xóa',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }

    if (
      meeting.status !== MeetingStatus.PENDING_APPROVAL &&
      meeting.status !== MeetingStatus.SCHEDULED
    ) {
      throw new ConflictException({
        success: false,
        message: `Không thể thay đổi thời gian cho cuộc họp đang ở trạng thái "${meeting.status}".`,
        error: {
          code: 'MEETING_STATUS_NOT_EDITABLE',
          details: { meetingId, currentStatus: meeting.status },
        },
      });
    }

    const hasAnyPermission =
      authUser.userId === meeting.organizerId ||
      authUser.userId === meeting.hostId;

    if (!hasAnyPermission) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền thay đổi thời gian cuộc họp này.',
        error: {
          code: 'MEETING_TIME_UPDATE_FORBIDDEN',
          details: { meetingId },
        },
      });
    }

    const newStartTime = new Date(dto.startTime);
    const newEndTime = new Date(dto.endTime);

    if (
      Number.isNaN(newStartTime.getTime()) ||
      Number.isNaN(newEndTime.getTime())
    ) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Định dạng thời gian không hợp lệ',
        error: { code: 'INVALID_DATE_FORMAT', details: {} },
      });
    }

    if (newStartTime >= newEndTime) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Thời gian bắt đầu phải trước thời gian kết thúc',
        error: { code: 'INVALID_TIME_RANGE', details: {} },
      });
    }

    const now = new Date();
    if (
      newStartTime.getTime() <= now.getTime() ||
      newEndTime.getTime() <= now.getTime()
    ) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Không thể dời lịch họp về thời điểm trong quá khứ',
        error: { code: 'MEETING_TIME_IN_PAST', details: {} },
      });
    }

    const durationMs = newEndTime.getTime() - newStartTime.getTime();
    const durationMinutes = durationMs / (1000 * 60);
    if (durationMinutes < 15 || durationMinutes > 480) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Thời lượng cuộc họp phải từ 15 phút đến 8 giờ',
        error: { code: 'MEETING_DURATION_OUT_OF_RANGE', details: {} },
      });
    }

    const oldMeetingData = {
      startTime: meeting.startTime.toISOString(),
      endTime: meeting.endTime.toISOString(),
      roomId: meeting.roomId,
    };

    if (!meeting.roomId) {
      throw new ConflictException({
        success: false,
        message: 'Cuộc họp không có phòng họp. Vui lòng liên hệ quản trị viên.',
        error: { code: 'MEETING_NO_ROOM_ASSIGNED', details: { meetingId } },
      });
    }

    let targetRoomId: string = meeting.roomId;
    let newRoomIdValue: string | null = null;

    if (dto.newRoomId) {
      newRoomIdValue = dto.newRoomId;
      const newRoom = await this.dataSource.getRepository(RoomEntity).findOne({
        where: { id: dto.newRoomId },
      });

      if (!newRoom) {
        throw new NotFoundException({
          success: false,
          message: 'Phòng họp không tồn tại',
          error: { code: 'ROOM_NOT_FOUND', details: { roomId: dto.newRoomId } },
        });
      }

      if (!newRoom.isActive || newRoom.currentStatus === RoomStatus.INACTIVE) {
        throw new ConflictException({
          success: false,
          message: 'Phòng họp không khả dụng',
          error: {
            code: 'ROOM_NOT_AVAILABLE',
            details: { roomId: dto.newRoomId },
          },
        });
      }

      let attendeeCount = 0;
      if (meeting.expectedAttendeeCount) {
        attendeeCount = meeting.expectedAttendeeCount;
      } else {
        const participantCount = await this.dataSource
          .getRepository(MeetingParticipantEntity)
          .count({ where: { meetingId } });
        attendeeCount = participantCount;
      }

      if (attendeeCount > (newRoom.capacity || 0)) {
        throw new ConflictException({
          success: false,
          message: 'Phòng họp được chọn không đủ sức chứa',
          error: {
            code: 'ROOM_CAPACITY_INSUFFICIENT',
            details: {
              roomId: dto.newRoomId,
              roomCapacity: newRoom.capacity,
              requiredCapacity: attendeeCount,
            },
          },
        });
      }

      targetRoomId = dto.newRoomId;
    }

    const activeBooking = await this.dataSource
      .getRepository(RoomBookingEntity)
      .findOne({
        where: {
          meetingId,
          status: In([
            RoomBookingStatus.PENDING,
            RoomBookingStatus.APPROVED,
            RoomBookingStatus.ACTIVE,
          ]),
        },
      });

    const existingConflicts = await this.dataSource
      .getRepository(RoomBookingEntity)
      .find({
        where: {
          roomId: targetRoomId,
          status: In([
            RoomBookingStatus.PENDING,
            RoomBookingStatus.APPROVED,
            RoomBookingStatus.ACTIVE,
          ]),
          ...(activeBooking ? { id: Not(activeBooking.id) } : {}),
          reservedStartTime: LessThanOrEqual(newEndTime),
          reservedEndTime: MoreThanOrEqual(newStartTime),
        },
      });

    if (existingConflicts.length > 0) {
      const conflictRoom = await this.dataSource
        .getRepository(RoomEntity)
        .findOne({ where: { id: targetRoomId } });
      const roomName = conflictRoom?.roomName || targetRoomId;

      const allAvailable = await this.getAvailableRooms(
        newStartTime,
        newEndTime,
      );
      const suggestedRooms = allAvailable
        .filter((r) => r.id !== targetRoomId)
        .slice(0, 5)
        .map((r) => ({
          roomId: r.id,
          roomName: r.roomName,
          capacity: r.capacity,
        }));

      throw new ConflictException({
        success: false,
        message: `Phòng họp ${roomName} không khả dụng trong khung giờ mới.`,
        error: {
          code: 'ROOM_TIME_CONFLICT',
          details: {
            blocking: true,
            conflictedRoomId: targetRoomId,
            requestedStartTime: dto.startTime,
            requestedEndTime: dto.endTime,
            conflicts: existingConflicts.map((c) => ({
              conflictingBookingId: c.id,
              conflictingStartTime: c.reservedStartTime.toISOString(),
              conflictingEndTime: c.reservedEndTime.toISOString(),
            })),
            suggestedRooms,
          },
        },
      });
    }

    const participants = await this.dataSource
      .getRepository(MeetingParticipantEntity)
      .find({ where: { meetingId } });

    const internalUserIds = participants.map((p) => p.userId).filter(Boolean);

    let participantConflicts: Array<{
      userId: string;
      meetingTitle: string;
      meetingId: string;
      startTime: Date;
      endTime: Date;
    }> = [];

    if (internalUserIds.length > 0) {
      const conflictResult = await this.dataSource
        .getRepository(MeetingParticipantEntity)
        .createQueryBuilder('mp')
        .innerJoin('mp.meeting', 'm')
        .select(['mp.userId', 'm.startTime', 'm.endTime'])
        .where('mp.userId IN (:...userIds)', { userIds: internalUserIds })
        .andWhere('m.id != :meetingId', { meetingId })
        .andWhere('m.status NOT IN (:...excludedStatuses)', {
          excludedStatuses: [MeetingStatus.CANCELLED, MeetingStatus.COMPLETED],
        })
        .andWhere('m.startTime < :endTime', { endTime: newEndTime })
        .andWhere('m.endTime > :startTime', { startTime: newStartTime })
        .getMany();

      participantConflicts = conflictResult.map((mp) => {
        const m = (
          mp as unknown as {
            meeting: {
              title: string;
              id: string;
              startTime: Date;
              endTime: Date;
            };
          }
        ).meeting;
        return {
          userId: mp.userId,
          meetingTitle: m.title,
          meetingId: m.id,
          startTime: m.startTime,
          endTime: m.endTime,
        };
      });
    }

    if (participantConflicts.length > 0 && !dto.overrideParticipantConflict) {
      const participantIds = participantConflicts.map((c) => c.userId);
      const conflictUsers = await this.dataSource
        .getRepository(UserEntity)
        .find({ where: { id: In(participantIds) } });
      const userMap = new Map(
        conflictUsers.map((u) => [u.id, u.fullName || u.email]),
      );

      throw new ConflictException({
        success: false,
        message:
          'Khung giờ mới trùng lịch với một hoặc nhiều người tham gia. Vui lòng xác nhận nếu vẫn muốn tiếp tục.',
        error: {
          code: 'PARTICIPANT_TIME_CONFLICT_WARNING',
          details: {
            blocking: false,
            requiresConfirmation: true,
            conflicts: participantConflicts.map((c) => ({
              userId: c.userId,
              fullName: userMap.get(c.userId) || 'Unknown',
              overlappingMeetings: [
                {
                  meetingId: c.meetingId,
                  title: c.meetingTitle,
                  startTime: c.startTime.toISOString(),
                  endTime: c.endTime.toISOString(),
                },
              ],
            })),
          },
        },
      });
    }

    let bookingId = '';
    let notificationStatus = 'queued';
    let pendingApproval = false;
    let requestId = '';

    try {
      await this.dataSource.transaction(async (em) => {
        const lockedMeeting = await em.findOne(MeetingEntity, {
          where: { id: meetingId },
          lock: { mode: 'pessimistic_write' },
        });

        if (
          !lockedMeeting ||
          (lockedMeeting.status !== MeetingStatus.PENDING_APPROVAL &&
            lockedMeeting.status !== MeetingStatus.SCHEDULED)
        ) {
          throw new ConflictException({
            success: false,
            message: 'Cuộc họp đã thay đổi trạng thái. Vui lòng thử lại.',
            error: {
              code: 'MEETING_STATUS_NOT_EDITABLE',
              details: { meetingId },
            },
          });
        }

        if (lockedMeeting.status === MeetingStatus.PENDING_APPROVAL) {
          // ── 1b: chưa duyệt → sửa thoải mái, KHÔNG sinh request thứ 2 ──
          let booking: RoomBookingEntity | null = null;

          if (activeBooking) {
            booking = await em.findOne(RoomBookingEntity, {
              where: { id: activeBooking.id },
              lock: { mode: 'pessimistic_write' },
            });

            if (!booking) {
              throw new NotFoundException({
                success: false,
                message: 'Booking record không tồn tại',
                error: { code: 'ROOM_NOT_FOUND', details: {} },
              });
            }

            const recheckConflict = await em.find(RoomBookingEntity, {
              where: {
                roomId: targetRoomId,
                status: In([
                  RoomBookingStatus.PENDING,
                  RoomBookingStatus.APPROVED,
                  RoomBookingStatus.ACTIVE,
                ]),
                id: Not(booking.id),
                reservedStartTime: LessThanOrEqual(newEndTime),
                reservedEndTime: MoreThanOrEqual(newStartTime),
              },
            });

            if (recheckConflict.length > 0) {
              throw new ConflictException({
                success: false,
                message:
                  'Phòng họp không khả dụng trong khung giờ mới (xung đột tại thời điểm xác nhận).',
                error: {
                  code: 'ROOM_TIME_CONFLICT',
                  details: { blocking: true },
                },
              });
            }

            booking.roomId = targetRoomId;
            booking.reservedStartTime = newStartTime;
            booking.reservedEndTime = newEndTime;
            if (newRoomIdValue || targetRoomId !== meeting.roomId) {
              booking.bookingType = BookingType.RELOCATED;
            }
            await em.save(RoomBookingEntity, booking);
            bookingId = booking.id;
          } else {
            const bookingCode = await this.generateBookingCodeTransaction(em);
            const newBooking = em.create(RoomBookingEntity, {
              bookingCode,
              meetingId,
              roomId: targetRoomId,
              bookingType: BookingType.SCHEDULED,
              reservedStartTime: newStartTime,
              reservedEndTime: newEndTime,
              status: RoomBookingStatus.PENDING,
              bookedBy: authUser.userId,
            });
            await em.save(RoomBookingEntity, newBooking);
            bookingId = newBooking.id;

            const auditWarn = em.create(AuditLogEntity, {
              userId: authUser.userId,
              actionType: 'update',
              entityType: 'meeting_booking',
              entityId: meetingId,
              oldValueJson: null,
              newValueJson: {
                note: 'Missing booking record - created new booking',
              },
              metadataJson: { reason: dto.changeReason || null },
              ipAddress: clientContext.ipAddress || null,
              userAgent: clientContext.userAgent || null,
              severity: AuditLogSeverity.WARNING,
            });
            await em.save(AuditLogEntity, auditWarn);
          }

          const repo = em.getRepository(MeetingEntity);
          await repo.update(meetingId, {
            startTime: newStartTime,
            endTime: newEndTime,
            roomId: newRoomIdValue || targetRoomId,
            updatedBy: authUser.userId,
          });

          // Meeting mới tạo có đúng 1 MeetingRequest PENDING (từ createMeeting,
          // hoặc từ một lần sửa SCHEDULED→pending trước đó) — cập nhật ngay
          // trên request đó, KHÔNG tạo thêm request thứ 2.
          const pendingRequest = await em.findOne(MeetingRequestEntity, {
            where: { meetingId, approvalStatus: ApprovalStatus.PENDING },
            lock: { mode: 'pessimistic_write' },
          });

          if (!pendingRequest) {
            throw new ConflictException({
              success: false,
              message:
                'Không tìm thấy yêu cầu đang chờ duyệt cho cuộc họp này. Vui lòng liên hệ quản trị viên.',
              error: {
                code: 'PENDING_REQUEST_NOT_FOUND',
                details: { meetingId },
              },
            });
          }

          pendingRequest.requestedStartTime = newStartTime;
          pendingRequest.requestedEndTime = newEndTime;
          pendingRequest.targetRoomId = newRoomIdValue || targetRoomId;
          pendingRequest.requestPayloadJson = {
            ...pendingRequest.requestPayloadJson,
            startTime: dto.startTime,
            endTime: dto.endTime,
            newRoomId: dto.newRoomId || null,
            overrideParticipantConflict:
              dto.overrideParticipantConflict || false,
            changeReason: dto.changeReason || null,
          };
          await em.save(MeetingRequestEntity, pendingRequest);
          requestId = pendingRequest.id;

          const event = em.create(MeetingEventEntity, {
            meetingId,
            eventType: MeetingEventType.MEETING_TIME_UPDATED,
            actorUserId: authUser.userId,
            sourceType: MeetingEventSourceType.MANUAL,
            description: `Cập nhật thời gian yêu cầu cuộc họp "${meeting.title}" (đang chờ phê duyệt)`,
            oldValueJson: oldMeetingData as any,
            newValueJson: {
              startTime: dto.startTime,
              endTime: dto.endTime,
              roomId: targetRoomId,
              changeReason: dto.changeReason || null,
            } as any,
          });
          await em.save(MeetingEventEntity, event);

          const auditLog = em.create(AuditLogEntity, {
            userId: authUser.userId,
            actionType: 'update',
            entityType: 'meeting',
            entityId: meetingId,
            oldValueJson: oldMeetingData as any,
            newValueJson: {
              startTime: dto.startTime,
              endTime: dto.endTime,
              roomId: targetRoomId,
              changeReason: dto.changeReason || null,
            } as any,
            metadataJson: {
              reason: dto.changeReason || null,
              requestId: pendingRequest.id,
            } as any,
            ipAddress: clientContext.ipAddress || null,
            userAgent: clientContext.userAgent || null,
            severity: AuditLogSeverity.INFO,
          });
          await em.save(AuditLogEntity, auditLog);
        } else {
          // ── 1c: đã duyệt (SCHEDULED) → phải duyệt lại, KHÔNG áp ngay ──
          pendingApproval = true;

          const requestCode = await this.generateRequestCodeTransaction(
            em,
            'UPD',
          );
          const newRequest = em.create(MeetingRequestEntity, {
            requestCode,
            meetingId,
            requestType: MeetingRequestType.UPDATE_TIME,
            requestedBy: authUser.userId,
            targetRoomId,
            requestedStartTime: newStartTime,
            requestedEndTime: newEndTime,
            approvalMode: ApprovalMode.MANUAL,
            approvalStatus: ApprovalStatus.PENDING,
            conflictCheckStatus:
              participantConflicts.length > 0
                ? ConflictCheckStatus.WARNING
                : ConflictCheckStatus.CLEAR,
            conflictSummaryJson:
              participantConflicts.length > 0 ? { participantConflicts } : null,
            requestPayloadJson: {
              oldStartTime: oldMeetingData.startTime,
              oldEndTime: oldMeetingData.endTime,
              oldRoomId: oldMeetingData.roomId,
              startTime: dto.startTime,
              endTime: dto.endTime,
              newRoomId: dto.newRoomId || null,
              overrideParticipantConflict:
                dto.overrideParticipantConflict || false,
              changeReason: dto.changeReason || null,
            } as any,
          });
          await em.save(MeetingRequestEntity, newRequest);
          requestId = newRequest.id;

          await em.update(MeetingEntity, meetingId, {
            status: MeetingStatus.PENDING_APPROVAL,
            updatedBy: authUser.userId,
          });

          // Booking GIỮ NGUYÊN slot cũ cho tới khi được duyệt (tránh mất chỗ
          // nếu Manager từ chối) — không update/relocate ở bước này.
          const currentBooking = activeBooking
            ? activeBooking
            : await em.findOne(RoomBookingEntity, {
                where: { meetingId, roomId: meeting.roomId! },
                order: { createdAt: 'DESC' },
              });
          bookingId = currentBooking?.id || '';

          const event = em.create(MeetingEventEntity, {
            meetingId,
            eventType: MeetingEventType.MEETING_REQUEST_CREATED,
            actorUserId: authUser.userId,
            sourceType: MeetingEventSourceType.MANUAL,
            description: `Yêu cầu đổi thời gian cuộc họp "${meeting.title}" — chờ duyệt lại`,
            oldValueJson: oldMeetingData as any,
            newValueJson: {
              startTime: dto.startTime,
              endTime: dto.endTime,
              roomId: targetRoomId,
              changeReason: dto.changeReason || null,
            } as any,
          });
          await em.save(MeetingEventEntity, event);

          const auditLog = em.create(AuditLogEntity, {
            userId: authUser.userId,
            actionType: 'update_requested',
            entityType: 'meeting',
            entityId: meetingId,
            oldValueJson: oldMeetingData as any,
            newValueJson: {
              startTime: dto.startTime,
              endTime: dto.endTime,
              roomId: targetRoomId,
              changeReason: dto.changeReason || null,
            } as any,
            metadataJson: {
              reason: dto.changeReason || null,
              requestId: newRequest.id,
            } as any,
            ipAddress: clientContext.ipAddress || null,
            userAgent: clientContext.userAgent || null,
            severity: AuditLogSeverity.INFO,
          });
          await em.save(AuditLogEntity, auditLog);
        }
      });
    } catch (error: unknown) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error(
        `Transaction failed for meeting time update: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }

    if (pendingApproval) {
      // ── 1c: chưa áp dụng gì cả — chỉ báo Manager có yêu cầu chờ duyệt,
      // KHÔNG báo participants (họ chưa thấy thay đổi nào trên meeting) ──
      try {
        const approverIds = await this.resolveApproverIds();
        if (approverIds.length > 0) {
          await this.notificationsService.createNotification({
            notificationType: NotificationType.MEETING_REQUEST_CREATED,
            channel: NotificationChannel.IN_APP,
            subject: `Yêu cầu đổi giờ cuộc họp: ${meeting.title}`,
            content: `Yêu cầu đổi thời gian cho cuộc họp "${meeting.title}" đang chờ phê duyệt.`,
            relatedEntityType: 'meeting_request',
            relatedEntityId: requestId,
            recipientScope: 'user_list',
            recipientUserIds: approverIds,
            payloadJson: {
              oldStartTime: oldMeetingData.startTime,
              oldEndTime: oldMeetingData.endTime,
              newStartTime: dto.startTime,
              newEndTime: dto.endTime,
              changeReason: dto.changeReason || null,
            },
            createdBy: authUser.userId,
          });
        }
      } catch (notifError: unknown) {
        this.logger.error(
          `[updateMeetingTime] Approver notification failed for meeting ${meetingId}: ${(notifError as Error).message}`,
        );
        notificationStatus = 'failed';
      }
    } else {
      try {
        const externalParticipants = await this.dataSource
          .getRepository(MeetingExternalParticipantEntity)
          .find({ where: { meetingId } });

        const internalRecipientIds = participants
          .filter((p) => p.userId)
          .map((p) => p.userId);

        const allUserIds = [
          ...new Set([
            ...internalRecipientIds,
            meeting.organizerId,
            ...(meeting.hostId ? [meeting.hostId] : []),
          ]),
        ];

        const payloadJson = {
          oldStartTime: oldMeetingData.startTime,
          oldEndTime: oldMeetingData.endTime,
          newStartTime: dto.startTime,
          newEndTime: dto.endTime,
          oldRoomId: meeting.roomId,
          newRoomId: targetRoomId !== meeting.roomId ? targetRoomId : null,
          changeReason: dto.changeReason || null,
        };

        // IN_APP notification for all participants
        await this.notificationsService.createNotification({
          notificationType: NotificationType.MEETING_TIME_UPDATED,
          channel: NotificationChannel.IN_APP,
          subject: `Cập nhật thời gian cuộc họp: ${meeting.title}`,
          content: `Thời gian cuộc họp "${meeting.title}" đã được cập nhật.`,
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          recipientScope: 'user_list',
          recipientUserIds: allUserIds,
          payloadJson,
          createdBy: authUser.userId,
        });

        // EMAIL notification to non-actor + external participants
        const emailRecipientIds = allUserIds.filter(
          (id) => id !== authUser.userId,
        );
        if (emailRecipientIds.length > 0 || externalParticipants.length > 0) {
          const emailMap = await this.resolveUserEmails(
            emailRecipientIds,
            this.dataSource.manager,
          );
          const toEmails = [
            ...emailMap.values(),
            ...externalParticipants
              .filter((ep) => !!ep.email)
              .map((ep) => ep.email),
          ].filter(Boolean) as string[];
          if (toEmails.length > 0) {
            await this.notificationsService.enqueueEmailNotification({
              notificationType: NotificationType.MEETING_TIME_UPDATED,
              channel: NotificationChannel.EMAIL,
              subject: `Cập nhật thời gian cuộc họp: ${meeting.title}`,
              content: `Thời gian cuộc họp "${meeting.title}" đã được cập nhật.`,
              toEmails,
              relatedEntityType: 'meeting',
              relatedEntityId: meetingId,
              recipientScope: 'user_list',
              payloadJson,
              createdBy: authUser.userId,
            });
          }
        }
      } catch (notifError: unknown) {
        this.logger.error(
          `[updateMeetingTime] Notification failed for meeting ${meetingId}: ${(notifError as Error).message}`,
        );
        notificationStatus = 'failed';
      }
    }

    return {
      meetingId,
      oldStartTime: oldMeetingData.startTime,
      oldEndTime: oldMeetingData.endTime,
      newStartTime: dto.startTime,
      newEndTime: dto.endTime,
      oldRoomId: meeting.roomId,
      newRoomId: targetRoomId !== meeting.roomId ? targetRoomId : null,
      bookingId,
      notificationStatus,
      pendingApproval,
      requestId: pendingApproval ? requestId : undefined,
      updatedAt: new Date().toISOString(),
    };
  }

  // ── T007: Helpers ──────────────────────────────────────────────────

  async getAttendeeCount(meetingId: string): Promise<number> {
    const [internalCount, externalCount] = await Promise.all([
      this.dataSource.getRepository(MeetingParticipantEntity).count({
        where: { meetingId },
      }),
      this.dataSource
        .getRepository(MeetingExternalParticipantEntity)
        .count({ where: { meetingId } }),
    ]);
    return internalCount + externalCount;
  }

  async getAvailableRoomsForMeeting(
    meetingId: string,
    options?: {
      capacityWarningMode?: boolean;
      includeCurrentRoom?: boolean;
    },
  ): Promise<AvailableRoomDto[]> {
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Cuộc họp không tồn tại hoặc đã bị xóa',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }

    const startTime = meeting.startTime;
    const endTime = meeting.endTime;
    const currentRoomId = meeting.roomId;
    const includeCurrent = options?.includeCurrentRoom ?? false;

    const allRooms = await this.getAvailableRooms(startTime, endTime);

    let attendeeCount = 0;
    if (options?.capacityWarningMode) {
      attendeeCount = await this.getAttendeeCount(meetingId);
    }

    const result: AvailableRoomDto[] = [];

    for (const room of allRooms) {
      if (room.capacity === null) {
        continue;
      }

      if (!includeCurrent && room.id === currentRoomId) {
        continue;
      }

      let capacityWarning: CapacityWarning | null = null;
      if (
        options?.capacityWarningMode &&
        attendeeCount > (room.capacity ?? 0)
      ) {
        capacityWarning = {
          roomCapacity: room.capacity,
          attendeeCount,
          message: `Sức chứa của phòng (${room.capacity} người) nhỏ hơn số lượng người tham dự hiện tại (${attendeeCount} người).`,
        };
      }

      const equipmentFlags: string[] = [];
      if (room.hasCamera) equipmentFlags.push('camera');
      if (room.hasMicrophone) equipmentFlags.push('microphone');
      if (room.hasDisplay) equipmentFlags.push('display');

      const locationParts: string[] = [];
      if (room.siteName) locationParts.push(room.siteName);
      if (room.areaName) locationParts.push(room.areaName);
      if (room.locationDescription)
        locationParts.push(room.locationDescription);

      result.push({
        roomId: room.id,
        roomName: room.roomName,
        roomCode: room.roomCode,
        capacity: room.capacity,
        location: locationParts.length > 0 ? locationParts.join(', ') : null,
        equipmentFlags,
        availabilityStatus: 'available',
        isCurrentRoom: room.id === currentRoomId,
        capacityWarning,
      });
    }

    return result;
  }

  // ── T008: Helper ───────────────────────────────────────────────────

  private async generateBookingCodeTransaction(
    em: EntityManager,
  ): Promise<string> {
    const today = new Date();
    const dateStr =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, '0') +
      String(today.getDate()).padStart(2, '0');

    const count = await em.getRepository(RoomBookingEntity).count({
      where: {
        createdAt: MoreThanOrEqual(
          new Date(today.getFullYear(), today.getMonth(), today.getDate()),
        ),
      },
    });

    const seq = String(count + 1).padStart(3, '0');
    return `BK-${dateStr}-${seq}`;
  }

  /**
   * ⚠ KHÔNG dùng `count(...) + 1`: hai request đồng thời cùng đọc một `count` → cùng
   * seq → 23505 trên `ux_meeting_requests_code`. Nay dùng cùng pattern MAX-seq + kiểm
   * tồn tại như `generateRequestCode`, chạy trong transaction `em` hiện tại.
   */
  private async generateRequestCodeTransaction(
    em: EntityManager,
    prefix: string,
  ): Promise<string> {
    const fullPrefix = `${prefix}-${this.todayStamp()}-`;
    const repo = em.getRepository(MeetingRequestEntity);

    for (let attempt = 0; attempt < 10; attempt++) {
      const rows = await repo
        .createQueryBuilder('r')
        .select('r.requestCode', 'code')
        .where('r.requestCode LIKE :prefix', { prefix: `${fullPrefix}%` })
        .getRawMany<{ code: string }>();

      const next = this.maxSeqOf(
        rows.map((r) => r.code),
        fullPrefix,
      );
      const code = `${fullPrefix}${String(next + 1 + attempt).padStart(3, '0')}`;

      const exists = await repo
        .createQueryBuilder('r')
        .where('r.requestCode = :code', { code })
        .getCount();
      if (exists === 0) return code;
    }

    return `${fullPrefix}${Date.now().toString().slice(-6)}`;
  }

  // ── T009: Core Business Logic ──────────────────────────────────────

  async updateMeetingRoom(
    meetingId: string,
    dto: UpdateMeetingRoomDto,
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<UpdateMeetingRoomResponseDto> {
    // ─ Pre-validation ─
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
      relations: { organizer: true },
    });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Cuộc họp không tồn tại hoặc đã bị xóa',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }

    if (
      meeting.status !== MeetingStatus.PENDING_APPROVAL &&
      meeting.status !== MeetingStatus.SCHEDULED
    ) {
      throw new ConflictException({
        success: false,
        message: `Không thể đổi phòng cho cuộc họp đang ở trạng thái "${meeting.status}".`,
        error: {
          code: 'INVALID_MEETING_STATUS',
          details: { meetingId, currentStatus: meeting.status },
        },
      });
    }

    const now = new Date();
    if (now.getTime() >= meeting.startTime.getTime()) {
      throw new ConflictException({
        success: false,
        message: 'Không thể đổi phòng trên hệ thống khi cuộc họp đã bắt đầu.',
        error: { code: 'MEETING_ALREADY_STARTED', details: { meetingId } },
      });
    }

    if (meeting.recurrenceRuleId && meeting.parentMeetingId === null) {
      throw new ConflictException({
        success: false,
        message:
          'Không thể đổi phòng cho cuộc họp định kỳ. Vui lòng thao tác trên từng cuộc họp cụ thể.',
        error: {
          code: 'RECURRING_SERIES_UPDATE_NOT_SUPPORTED',
          details: { meetingId },
        },
      });
    }

    const isOwner =
      meeting.organizerId === authUser.userId ||
      meeting.hostId === authUser.userId;

    if (!isOwner) {
      const hasPermission = await this.checkUserPermission(
        authUser.userId,
        'meeting.room.update',
      );
      if (!hasPermission) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không có quyền cập nhật phòng họp cho cuộc họp này.',
          error: { code: 'FORBIDDEN', details: { meetingId } },
        });
      }
    }

    if (!meeting.roomId) {
      throw new ConflictException({
        success: false,
        message: 'Cuộc họp không có phòng họp. Vui lòng liên hệ quản trị viên.',
        error: { code: 'MEETING_NO_ROOM_ASSIGNED', details: { meetingId } },
      });
    }

    if (dto.newRoomId === meeting.roomId) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Phòng họp mới phải khác phòng họp hiện tại.',
        error: { code: 'SAME_ROOM', details: { roomId: meeting.roomId } },
      });
    }

    const newRoom = await this.dataSource.getRepository(RoomEntity).findOne({
      where: { id: dto.newRoomId },
    });

    if (!newRoom || !newRoom.isActive || newRoom.currentStatus === 'inactive') {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Phòng họp này hiện không khả dụng.',
        error: {
          code: 'ROOM_NOT_AVAILABLE',
          details: { roomId: dto.newRoomId },
        },
      });
    }

    if (newRoom.capacity === null) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Phòng họp được chọn chưa được cấu hình sức chứa.',
        error: {
          code: 'ROOM_CAPACITY_NOT_CONFIGURED',
          details: { roomId: dto.newRoomId },
        },
      });
    }

    const attendeeCount = await this.getAttendeeCount(meetingId);

    if (attendeeCount > newRoom.capacity && !dto.confirmCapacityOverride) {
      throw new UnprocessableEntityException({
        success: false,
        message: `Sức chứa của phòng (${newRoom.capacity} người) nhỏ hơn số lượng người tham dự hiện tại (${attendeeCount} người). Bạn có chắc chắn muốn tiếp tục?`,
        error: {
          code: 'ROOM_CAPACITY_WARNING',
          details: {
            roomCapacity: newRoom.capacity,
            attendeeCount,
            requiresConfirmation: true,
          },
        },
      });
    }

    const oldBooking = await this.dataSource
      .getRepository(RoomBookingEntity)
      .findOne({
        where: {
          meetingId,
          roomId: meeting.roomId,
          status: In([
            RoomBookingStatus.PENDING,
            RoomBookingStatus.APPROVED,
            RoomBookingStatus.ACTIVE,
          ]),
        },
      });

    const conflict = await this.dataSource
      .getRepository(RoomBookingEntity)
      .findOne({
        where: {
          roomId: dto.newRoomId,
          status: In([
            RoomBookingStatus.PENDING,
            RoomBookingStatus.APPROVED,
            RoomBookingStatus.ACTIVE,
          ]),
          ...(oldBooking ? { id: Not(oldBooking.id) } : {}),
          reservedStartTime: LessThanOrEqual(meeting.endTime),
          reservedEndTime: MoreThanOrEqual(meeting.startTime),
        },
      });

    if (conflict) {
      throw new ConflictException({
        success: false,
        message:
          'Phòng họp này vừa được đặt bởi người khác. Vui lòng chọn một phòng khả dụng khác.',
        error: { code: 'ROOM_CONFLICT', details: { roomId: dto.newRoomId } },
      });
    }

    const oldRoom = await this.dataSource.getRepository(RoomEntity).findOne({
      where: { id: meeting.roomId },
    });
    const oldRoomName = oldRoom?.roomName || meeting.roomId;
    const newRoomName = newRoom.roomName;

    const oldMeetingData = {
      roomId: meeting.roomId,
      roomName: oldRoomName,
    };

    let newBookingId = '';
    let notificationStatus = 'queued';
    let pendingApproval = false;
    let requestId = '';

    try {
      await this.dataSource.transaction(async (em) => {
        const lockedMeeting = await em.findOne(MeetingEntity, {
          where: { id: meetingId },
          lock: { mode: 'pessimistic_write' },
        });

        if (
          !lockedMeeting ||
          (lockedMeeting.status !== MeetingStatus.PENDING_APPROVAL &&
            lockedMeeting.status !== MeetingStatus.SCHEDULED)
        ) {
          throw new ConflictException({
            success: false,
            message: 'Cuộc họp đã thay đổi trạng thái. Vui lòng thử lại.',
            error: { code: 'INVALID_MEETING_STATUS', details: { meetingId } },
          });
        }

        if (lockedMeeting.roomId !== meeting.roomId) {
          throw new ConflictException({
            success: false,
            message: 'Phòng họp đã được thay đổi bởi người khác.',
            error: { code: 'ROOM_ALREADY_CHANGED', details: { meetingId } },
          });
        }

        if (lockedMeeting.status === MeetingStatus.PENDING_APPROVAL) {
          // ── 1b: chưa duyệt → sửa thoải mái, KHÔNG sinh request thứ 2 ──
          await em.update(
            RoomBookingEntity,
            {
              meetingId,
              roomId: meeting.roomId,
              status: Not(RoomBookingStatus.RELEASED),
            },
            { status: RoomBookingStatus.RELEASED },
          );

          const bookingCode = await this.generateBookingCodeTransaction(em);

          const newBooking = em.create(RoomBookingEntity, {
            bookingCode,
            meetingId,
            roomId: dto.newRoomId,
            bookingType: BookingType.RELOCATED,
            reservedStartTime: meeting.startTime,
            reservedEndTime: meeting.endTime,
            status: RoomBookingStatus.PENDING,
            bookedBy: authUser.userId,
          });
          await em.save(RoomBookingEntity, newBooking);
          newBookingId = newBooking.id;

          await em.update(MeetingEntity, meetingId, {
            roomId: dto.newRoomId,
            updatedBy: authUser.userId,
          });

          await em.save(MeetingEventEntity, {
            meetingId,
            eventType: MeetingEventType.ROOM_CHANGED,
            actorUserId: authUser.userId,
            sourceType: MeetingEventSourceType.MANUAL,
            description: `Đổi phòng yêu cầu từ "${oldRoomName}" sang "${newRoomName}" (đang chờ phê duyệt)`,
            oldValueJson: { roomId: meeting.roomId, roomName: oldRoomName },
            newValueJson: { roomId: dto.newRoomId, roomName: newRoomName },
            metadataJson: {
              changeReason: dto.changeReason || null,
              confirmCapacityOverride: dto.confirmCapacityOverride || false,
            } as any,
          });

          const oldBookingRecord = oldBooking
            ? oldBooking
            : await em.findOne(RoomBookingEntity, {
                where: { meetingId, roomId: meeting.roomId! },
                order: { createdAt: 'DESC' },
              });

          await em.save(RoomEventEntity, {
            roomId: meeting.roomId!,
            meetingId,
            bookingId: oldBookingRecord?.id || null,
            eventType: 'room_released',
            sourceType: 'manual',
            actorUserId: authUser.userId,
            oldStatus: oldBookingRecord?.status || null,
            newStatus: RoomBookingStatus.RELEASED,
            description: `Phòng được giải phóng do đổi sang "${newRoomName}"`,
          });

          await em.save(RoomEventEntity, {
            roomId: dto.newRoomId,
            meetingId,
            bookingId: newBooking.id,
            eventType: 'room_reserved',
            sourceType: 'manual',
            actorUserId: authUser.userId,
            newStatus: RoomBookingStatus.PENDING,
            description: `Phòng được đặt lại từ "${oldRoomName}" (đang chờ phê duyệt)`,
          });

          // Meeting mới tạo có đúng 1 MeetingRequest PENDING — cập nhật ngay
          // trên request đó, KHÔNG tạo thêm request thứ 2.
          const pendingRequest = await em.findOne(MeetingRequestEntity, {
            where: { meetingId, approvalStatus: ApprovalStatus.PENDING },
            lock: { mode: 'pessimistic_write' },
          });

          if (!pendingRequest) {
            throw new ConflictException({
              success: false,
              message:
                'Không tìm thấy yêu cầu đang chờ duyệt cho cuộc họp này. Vui lòng liên hệ quản trị viên.',
              error: {
                code: 'PENDING_REQUEST_NOT_FOUND',
                details: { meetingId },
              },
            });
          }

          pendingRequest.targetRoomId = dto.newRoomId;
          pendingRequest.requestedStartTime = meeting.startTime;
          pendingRequest.requestedEndTime = meeting.endTime;
          pendingRequest.requestPayloadJson = {
            ...pendingRequest.requestPayloadJson,
            changeReason: dto.changeReason || null,
            confirmCapacityOverride: dto.confirmCapacityOverride || false,
            oldRoomId: meeting.roomId,
          };
          await em.save(MeetingRequestEntity, pendingRequest);
          requestId = pendingRequest.id;

          await em.save(AuditLogEntity, {
            userId: authUser.userId,
            actionType: 'update_room',
            entityType: 'meeting',
            entityId: meetingId,
            oldValueJson: {
              roomId: meeting.roomId,
              roomName: oldRoomName,
            } as any,
            newValueJson: {
              roomId: dto.newRoomId,
              roomName: newRoomName,
              changeReason: dto.changeReason || null,
              confirmCapacityOverride: dto.confirmCapacityOverride || false,
            } as any,
            metadataJson: { requestId: pendingRequest.id },
            ipAddress: clientContext.ipAddress || null,
            userAgent: clientContext.userAgent || null,
            severity: AuditLogSeverity.INFO,
          });
        } else {
          // ── 1c: đã duyệt (SCHEDULED) → phải duyệt lại, KHÔNG áp ngay ──
          pendingApproval = true;

          // Booking GIỮ NGUYÊN phòng cũ cho tới khi được duyệt (tránh mất
          // chỗ nếu Manager từ chối) — không release/relocate ở bước này.
          newBookingId = oldBooking?.id || '';

          const requestCode = await this.generateRequestCodeTransaction(
            em,
            'UPD',
          );
          const newRequest = em.create(MeetingRequestEntity, {
            requestCode,
            meetingId,
            requestType: MeetingRequestType.UPDATE_ROOM,
            requestedBy: authUser.userId,
            targetRoomId: dto.newRoomId,
            requestedStartTime: meeting.startTime,
            requestedEndTime: meeting.endTime,
            approvalMode: ApprovalMode.MANUAL,
            approvalStatus: ApprovalStatus.PENDING,
            conflictCheckStatus: ConflictCheckStatus.CLEAR,
            requestPayloadJson: {
              changeReason: dto.changeReason || null,
              confirmCapacityOverride: dto.confirmCapacityOverride || false,
              oldRoomId: meeting.roomId,
              oldRoomName,
              newRoomId: dto.newRoomId,
              newRoomName,
            } as any,
          });
          await em.save(MeetingRequestEntity, newRequest);
          requestId = newRequest.id;

          await em.update(MeetingEntity, meetingId, {
            status: MeetingStatus.PENDING_APPROVAL,
            updatedBy: authUser.userId,
          });

          await em.save(MeetingEventEntity, {
            meetingId,
            eventType: MeetingEventType.MEETING_REQUEST_CREATED,
            actorUserId: authUser.userId,
            sourceType: MeetingEventSourceType.MANUAL,
            description: `Yêu cầu đổi phòng cuộc họp "${meeting.title}" từ "${oldRoomName}" sang "${newRoomName}" — chờ duyệt lại`,
            oldValueJson: { roomId: meeting.roomId, roomName: oldRoomName },
            newValueJson: { roomId: dto.newRoomId, roomName: newRoomName },
            metadataJson: {
              changeReason: dto.changeReason || null,
              confirmCapacityOverride: dto.confirmCapacityOverride || false,
            } as any,
          });

          await em.save(AuditLogEntity, {
            userId: authUser.userId,
            actionType: 'update_room_requested',
            entityType: 'meeting',
            entityId: meetingId,
            oldValueJson: {
              roomId: meeting.roomId,
              roomName: oldRoomName,
            } as any,
            newValueJson: {
              roomId: dto.newRoomId,
              roomName: newRoomName,
              changeReason: dto.changeReason || null,
              confirmCapacityOverride: dto.confirmCapacityOverride || false,
            } as any,
            metadataJson: { requestId: newRequest.id },
            ipAddress: clientContext.ipAddress || null,
            userAgent: clientContext.userAgent || null,
            severity: AuditLogSeverity.INFO,
          });
        }
      });
    } catch (error: unknown) {
      if (
        error instanceof ConflictException ||
        error instanceof UnprocessableEntityException
      ) {
        throw error;
      }
      this.logger.error(
        `Transaction failed for meeting room update: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }

    if (pendingApproval) {
      // ── 1c: chưa áp dụng gì cả — chỉ báo Manager có yêu cầu chờ duyệt,
      // KHÔNG báo participants (phòng thực tế chưa đổi) ──
      try {
        const approverIds = await this.resolveApproverIds();
        if (approverIds.length > 0) {
          await this.notificationsService.createNotification({
            notificationType: NotificationType.MEETING_REQUEST_CREATED,
            channel: NotificationChannel.IN_APP,
            subject: `Yêu cầu đổi phòng cuộc họp: ${meeting.title}`,
            content: `Yêu cầu đổi phòng cho cuộc họp "${meeting.title}" từ "${oldRoomName}" sang "${newRoomName}" đang chờ phê duyệt.`,
            relatedEntityType: 'meeting_request',
            relatedEntityId: requestId,
            recipientScope: 'user_list',
            recipientUserIds: approverIds,
            payloadJson: {
              oldRoomId: meeting.roomId,
              oldRoomName,
              newRoomId: dto.newRoomId,
              newRoomName,
              changeReason: dto.changeReason || null,
            },
            createdBy: authUser.userId,
          });
        }
      } catch (notifError: unknown) {
        this.logger.error(
          `[updateMeetingRoom] Approver notification failed for meeting ${meetingId}: ${(notifError as Error).message}`,
        );
        notificationStatus = 'failed';
      }
    } else {
      try {
        const participants = await this.dataSource
          .getRepository(MeetingParticipantEntity)
          .find({ where: { meetingId } });

        const externalParticipants = await this.dataSource
          .getRepository(MeetingExternalParticipantEntity)
          .find({ where: { meetingId } });

        const internalRecipientIds = (participants || [])
          .filter((p) => p.userId)
          .map((p) => p.userId);

        const allUserIds = [
          ...new Set([
            ...internalRecipientIds,
            meeting.organizerId,
            ...(meeting.hostId ? [meeting.hostId] : []),
          ]),
        ];

        const payloadJson = {
          oldRoomId: meeting.roomId,
          oldRoomName,
          newRoomId: dto.newRoomId,
          newRoomName,
          changeReason: dto.changeReason || null,
        };

        // IN_APP notification for all participants
        await this.notificationsService.createNotification({
          notificationType: NotificationType.MEETING_ROOM_UPDATED,
          channel: NotificationChannel.IN_APP,
          subject: `Cập nhật phòng họp: ${meeting.title}`,
          content: `Phòng họp cho cuộc họp "${meeting.title}" đã được thay đổi từ "${oldRoomName}" sang "${newRoomName}".`,
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          recipientScope: 'user_list',
          recipientUserIds: allUserIds,
          payloadJson,
          createdBy: authUser.userId,
        });

        // EMAIL notification to non-actor + external participants
        const emailRecipientIds = allUserIds.filter(
          (id) => id !== authUser.userId,
        );
        if (
          emailRecipientIds.length > 0 ||
          (externalParticipants || []).length > 0
        ) {
          const emailMap = await this.resolveUserEmails(
            emailRecipientIds,
            this.dataSource.manager,
          );
          const toEmails = [
            ...emailMap.values(),
            ...(externalParticipants || [])
              .filter((ep) => !!ep.email)
              .map((ep) => ep.email),
          ].filter(Boolean) as string[];
          if (toEmails.length > 0) {
            await this.notificationsService.enqueueEmailNotification({
              notificationType: NotificationType.MEETING_ROOM_UPDATED,
              channel: NotificationChannel.EMAIL,
              subject: `Cập nhật phòng họp: ${meeting.title}`,
              content: `Phòng họp cho cuộc họp "${meeting.title}" đã được thay đổi từ "${oldRoomName}" sang "${newRoomName}".`,
              toEmails,
              relatedEntityType: 'meeting',
              relatedEntityId: meetingId,
              recipientScope: 'user_list',
              payloadJson,
              createdBy: authUser.userId,
            });
          }
        }
      } catch (notifError: unknown) {
        this.logger.error(
          `[updateMeetingRoom] Notification failed for meeting ${meetingId}: ${(notifError as Error).message}`,
        );
        notificationStatus = 'failed';
      }
    }

    return {
      meetingId,
      oldRoom: { id: meeting.roomId, name: oldRoomName },
      newRoom: { id: dto.newRoomId, name: newRoomName },
      oldBookingId: oldBooking?.id || '',
      newBookingId,
      startTime: meeting.startTime.toISOString(),
      endTime: meeting.endTime.toISOString(),
      notificationStatus,
      pendingApproval,
      requestId: pendingApproval ? requestId : undefined,
      updatedAt: new Date().toISOString(),
    };
  }

  // ── T004: Cancel Meeting ─────────────────────────────────────────────

  async cancelMeeting(
    meetingId: string,
    authUser: AuthUser,
    clientContext: ClientContext,
    cancellationReason?: string,
  ): Promise<CancelMeetingResponseDto> {
    // ── Step 1: Load meeting + validate existence ──
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Cuộc họp không tồn tại hoặc đã bị xóa',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }

    // ── Step 2: Authorization check (owner or admin) ──
    const isOwner =
      meeting.organizerId === authUser.userId ||
      meeting.hostId === authUser.userId;

    if (!isOwner) {
      const hasAnyPermission = await this.checkUserPermission(
        authUser.userId,
        'meeting.cancel.any',
      );
      if (!hasAnyPermission) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không có quyền hủy cuộc họp này',
          error: {
            code: 'FORBIDDEN',
            details: {
              requiredPermission: 'meeting.cancel.own or meeting.cancel.any',
              isOrganizer: meeting.organizerId === authUser.userId,
              isHost: meeting.hostId === authUser.userId,
              isAdmin: false,
            },
          },
        });
      }
    }

    // ── Step 3: Business validation ──
    if (meeting.status !== MeetingStatus.SCHEDULED) {
      const message =
        meeting.status === MeetingStatus.IN_PROGRESS
          ? "Cuộc họp đã bắt đầu. Bạn không thể hủy mà chỉ có thể chọn 'Kết thúc sớm'."
          : 'Trạng thái cuộc họp không hợp lệ để thực hiện thao tác này.';
      throw new ConflictException({
        success: false,
        message,
        error: {
          code:
            meeting.status === MeetingStatus.IN_PROGRESS
              ? 'MEETING_ALREADY_STARTED'
              : 'INVALID_MEETING_STATUS',
          details: { meetingId, currentStatus: meeting.status },
        },
      });
    }

    const now = new Date();
    if (now.getTime() >= meeting.startTime.getTime()) {
      throw new ConflictException({
        success: false,
        message:
          "Cuộc họp đã bắt đầu. Bạn không thể hủy mà chỉ có thể chọn 'Kết thúc sớm'.",
        error: {
          code: 'MEETING_ALREADY_STARTED',
          details: {
            meetingId,
            startTime: meeting.startTime.toISOString(),
            currentTime: now.toISOString(),
          },
        },
      });
    }

    // ── Step 4: Transaction with pessimistic locks ──
    let transactionResult: {
      cancelledAt: Date;
      roomReleased: boolean;
      releasedBookingId: string | null;
    };

    try {
      transactionResult = await this.dataSource.transaction(async (em) => {
        // 4a. Lock meeting row
        const lockedMeeting = await em.query(
          `SELECT id, status, start_time, end_time, organizer_id, host_id,
                  title, cancellation_reason, updated_at
           FROM meetings
           WHERE id = $1 AND deleted_at IS NULL
           FOR UPDATE`,
          [meetingId],
        );

        if (!lockedMeeting?.[0]) {
          throw new NotFoundException({
            success: false,
            message: 'Cuộc họp không tồn tại hoặc đã bị xóa',
            error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
          });
        }

        const lockedMeetingData = lockedMeeting[0];

        // 4b. Re-validate after lock (concurrent guard)
        if (lockedMeetingData.status === 'cancelled') {
          throw new ConflictException({
            success: false,
            message: 'Cuộc họp đã được hủy bởi một yêu cầu khác',
            error: { code: 'CONCURRENT_MODIFICATION', details: { meetingId } },
          });
        }

        let roomReleased = false;
        let releasedBookingId: string | null = null;

        // 4c. Query room_bookings with FOR UPDATE
        const bookings = await em.query(
          `SELECT id, room_id, status, start_time, end_time
           FROM room_bookings
           WHERE meeting_id = $1 AND status IN ('pending', 'approved')
           FOR UPDATE`,
          [meetingId],
        );
        const booking = bookings?.[0] ?? null;

        if (booking) {
          const previousBookingStatus = booking.status;
          roomReleased = true;
          releasedBookingId = booking.id;

          // 4d. Lock & query room_booking_usages
          const usages = await em.query(
            `SELECT id, usage_status
             FROM room_booking_usages
             WHERE booking_id = $1 AND usage_status = 'not_started'
             FOR UPDATE`,
            [booking.id],
          );
          const usage = usages?.[0] ?? null;

          // 4e. UPDATE room_bookings → cancelled + cancellation_reason
          await em.query(
            `UPDATE room_bookings
             SET status = 'cancelled',
                 cancellation_reason = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [cancellationReason?.trim() ?? null, booking.id],
          );

          // 4f. UPDATE room_booking_usages IF exists AND not_started
          if (usage) {
            await em.query(
              `UPDATE room_booking_usages
               SET usage_status = 'released',
                   released_at = NOW(),
                   released_by = $1,
                   release_reason = $2
               WHERE id = $3`,
              [authUser.userId, cancellationReason?.trim() ?? null, usage.id],
            );
          }

          // 4g. INSERT room_events
          await em.query(
            `INSERT INTO room_events (room_id, booking_id, meeting_id, event_type,
              old_status, new_status, description, source_type, actor_user_id)
             VALUES ($1, $2, $3, 'room_released', $4, 'cancelled', $5, 'manual', $6)`,
            [
              booking.room_id,
              booking.id,
              meetingId,
              previousBookingStatus,
              `Phòng đã được giải phóng do cuộc họp "${lockedMeetingData.title}" bị hủy.`,
              authUser.userId,
            ],
          );

          // 4h. INSERT audit_log for release room
          await em.query(
            `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id,
              old_value_json, new_value_json, metadata_json, severity,
              ip_address, user_agent)
             VALUES ($1, 'release_room', 'room_booking', $2, $3::jsonb, $4::jsonb, $5::jsonb, 'info', $6, $7)`,
            [
              authUser.userId,
              booking.id,
              JSON.stringify({ status: previousBookingStatus }),
              JSON.stringify({ status: 'cancelled' }),
              JSON.stringify({
                reason: cancellationReason ?? null,
                meetingId,
              }),
              clientContext.ipAddress ?? null,
              clientContext.userAgent ?? null,
            ],
          );
        }

        // 4i. UPDATE meetings
        await em.query(
          `UPDATE meetings
           SET status = 'cancelled',
               cancellation_reason = $1,
               updated_by = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [cancellationReason?.trim() ?? null, authUser.userId, meetingId],
        );

        // 4j. Query updated meeting for cancelledAt
        const updatedMeeting = await em.query(
          `SELECT updated_at FROM meetings WHERE id = $1`,
          [meetingId],
        );
        const cancelledAt =
          (updatedMeeting[0]?.updated_at as Date) ?? new Date();

        // 4k. INSERT meeting_events
        await em.query(
          `INSERT INTO meeting_events (meeting_id, event_type, event_time,
            actor_user_id, source_type, description,
            old_value_json, new_value_json, metadata_json)
           VALUES ($1, 'status_changed', NOW(), $2, 'manual', $3, $4::jsonb, $5::jsonb, $6::jsonb)`,
          [
            meetingId,
            authUser.userId,
            `Cuộc họp "${lockedMeetingData.title}" đã bị hủy.` +
              (cancellationReason ? ` Lý do: ${cancellationReason}` : ''),
            JSON.stringify({ status: lockedMeetingData.status }),
            JSON.stringify({ status: 'cancelled' }),
            JSON.stringify({
              action: 'cancel_meeting',
              reason: cancellationReason ?? null,
            }),
          ],
        );

        // 4l. INSERT audit_log for cancel meeting
        await em.query(
          `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id,
            old_value_json, new_value_json, metadata_json, severity,
            ip_address, user_agent)
           VALUES ($1, 'cancel_meeting', 'meeting', $2, $3::jsonb, $4::jsonb, $5::jsonb, 'info', $6, $7)`,
          [
            authUser.userId,
            meetingId,
            JSON.stringify({ status: lockedMeetingData.status }),
            JSON.stringify({ status: 'cancelled' }),
            JSON.stringify({ reason: cancellationReason ?? null }),
            clientContext.ipAddress ?? null,
            clientContext.userAgent ?? null,
          ],
        );

        return { cancelledAt, roomReleased, releasedBookingId };
      });
    } catch (error: unknown) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error(
        `Transaction failed for meeting cancel: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }

    // ── Step 4m (recon B2/B4): gỡ face mapping của meeting bị hủy — ngoài
    // transaction (gọi thiết bị ngoài), best-effort như notification bên
    // dưới. Không gỡ → mapping còn sống chiếm slot (device,user) vĩnh viễn,
    // họp sau cùng slot bị defer mãi (B4).
    try {
      await this.faceProvisioningService.deprovisionMeeting({
        id: meetingId,
        room_id: meeting.roomId,
        start_time: meeting.startTime,
        end_time: meeting.endTime,
      });
    } catch (faceError: unknown) {
      this.logger.error(
        `[cancelMeeting] deprovisionMeeting failed for meeting ${meetingId}: ${(faceError as Error).message}`,
      );
    }

    // ── Step 5: Outside transaction — notification via NotificationsService ──
    let notificationStatus = 'queued';

    try {
      const participants = await this.dataSource
        .getRepository(MeetingParticipantEntity)
        .find({ where: { meetingId } });

      const externalParticipants = await this.dataSource
        .getRepository(MeetingExternalParticipantEntity)
        .find({ where: { meetingId } });

      const internalRecipientIds = (participants || [])
        .filter((p) => p.userId)
        .map((p) => p.userId);

      const allUserIds = [
        ...new Set([
          ...internalRecipientIds,
          meeting.organizerId,
          ...(meeting.hostId ? [meeting.hostId] : []),
        ]),
      ];

      const notificationReasonStr = cancellationReason
        ? ` Lý do: ${cancellationReason}`
        : '';

      const payloadJson = {
        action: 'cancel_meeting',
        meetingId,
        reason: cancellationReason ?? null,
      };

      // IN_APP notification for all participants
      await this.notificationsService.createNotification({
        notificationType: NotificationType.CANCELLATION,
        channel: NotificationChannel.IN_APP,
        subject: `[CANCELLED] ${meeting.title}`,
        content: `Cuộc họp "${meeting.title}" đã bị hủy.${notificationReasonStr}`,
        relatedEntityType: 'meeting',
        relatedEntityId: meetingId,
        recipientScope: 'user_list',
        recipientUserIds: allUserIds,
        payloadJson,
        createdBy: authUser.userId,
      });

      // EMAIL to internal (excluding actor) + external participants
      const emailRecipientIds = allUserIds.filter(
        (id) => id !== authUser.userId,
      );
      if (
        emailRecipientIds.length > 0 ||
        (externalParticipants || []).length > 0
      ) {
        const emailMap = await this.resolveUserEmails(
          emailRecipientIds,
          this.dataSource.manager,
        );
        const extEmails = (externalParticipants || [])
          .filter((ep) => !!ep.email)
          .map((ep) => ep.email);
        const toEmails = [...emailMap.values(), ...extEmails].filter(
          Boolean,
        ) as string[];
        if (toEmails.length > 0) {
          await this.notificationsService.enqueueEmailNotification({
            notificationType: NotificationType.CANCELLATION,
            channel: NotificationChannel.EMAIL,
            subject: `[CANCELLED] ${meeting.title}`,
            content: `Cuộc họp "${meeting.title}" đã bị hủy.${notificationReasonStr}`,
            toEmails,
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            recipientScope: 'user_list',
            payloadJson,
            createdBy: authUser.userId,
          });
        }
      }
    } catch (notifError: unknown) {
      this.logger.error(
        `[cancelMeeting] Failed to queue cancellation notification for meeting ${meetingId}: ${(notifError as Error).message}`,
        (notifError as Error).stack,
      );
      await this.dataSource.getRepository(AuditLogEntity).save({
        userId: authUser.userId,
        actionType: 'notification_failure',
        entityType: 'meeting',
        entityId: meetingId,
        metadataJson: {
          error: 'Failed to queue cancellation notification',
          reason: cancellationReason ?? null,
        } as any,
        severity: AuditLogSeverity.WARNING,
      } as any);
      notificationStatus = 'failed_to_queue';
    }

    // ── Step 6: Return response ──
    return {
      meetingId,
      status: 'cancelled',
      cancelledAt: transactionResult.cancelledAt,
      cancelledBy: authUser.userId,
      roomReleased: transactionResult.roomReleased,
      releasedBookingId: transactionResult.releasedBookingId,
      notificationStatus,
    };
  }

  /**
   * Core persist cho internal participant (insert + audit, KHÔNG notification).
   * Dùng chung cho luồng add đơn lẻ và luồng import Excel.
   * Phải được gọi bên trong một transaction (nhận `em`).
   */
  async persistInternalParticipantCore(
    em: EntityManager,
    meetingId: string,
    userId: string,
    invitedBy: string,
    clientContext: ClientContext,
  ): Promise<string> {
    await em.findOne(MeetingEntity, {
      where: { id: meetingId },
      lock: { mode: 'pessimistic_write' },
    });

    const dupCheck = await em.findOne(MeetingParticipantEntity, {
      where: { meetingId, userId },
    });

    if (dupCheck) {
      throw new ConflictException({
        success: false,
        message: 'Người dùng đã có trong danh sách tham gia cuộc họp',
        error: { code: 'PARTICIPANT_ALREADY_EXISTS', details: {} },
      });
    }

    const participant = em.create(MeetingParticipantEntity, {
      meetingId,
      userId,
      participantRole: ParticipantRole.ATTENDEE,
      invitationStatus: InvitationStatus.PENDING,
      attendanceRequired: true,
      isRequired: true,
      invitedBy,
    });
    await em.save(MeetingParticipantEntity, participant);

    await em.save(AuditLogEntity, {
      userId: invitedBy,
      actionType: 'ADD_PARTICIPANT',
      entityType: 'meeting_participant',
      entityId: participant.id,
      newValueJson: {
        userId,
        meetingId,
        invitedBy,
      } as any,
      ipAddress: clientContext.ipAddress || null,
      userAgent: clientContext.userAgent || null,
      severity: AuditLogSeverity.INFO,
    });

    return participant.id;
  }

  /**
   * Core persist cho external participant (insert + event + audit, KHÔNG notification).
   * Dùng chung cho luồng add đơn lẻ và luồng import Excel.
   * Phải được gọi bên trong một transaction (nhận `em`).
   */
  async persistExternalParticipantCore(
    em: EntityManager,
    meetingId: string,
    data: {
      fullName: string;
      email: string;
      organizationName: string | null;
      phoneNumber: string | null;
    },
    actorUserId: string,
    clientContext: ClientContext,
  ): Promise<string> {
    await em.findOne(MeetingEntity, {
      where: { id: meetingId },
      lock: { mode: 'pessimistic_write' },
    });

    const dupInTx = await em
      .getRepository(MeetingExternalParticipantEntity)
      .createQueryBuilder('ep')
      .where('ep.meetingId = :meetingId AND LOWER(ep.email) = LOWER(:email)', {
        meetingId,
        email: data.email,
      })
      .getOne();

    if (dupInTx) {
      throw new ConflictException({
        success: false,
        message: 'Email khách mời đã tồn tại trong cuộc họp này',
        error: { code: 'EXTERNAL_PARTICIPANT_ALREADY_EXISTS', details: {} },
      });
    }

    const participant = em.create(MeetingExternalParticipantEntity, {
      meetingId,
      fullName: data.fullName,
      email: data.email,
      organizationName: data.organizationName ?? null,
      phoneNumber: data.phoneNumber ?? null,
      participantRole: 'attendee',
      invitationStatus: 'pending',
    });
    const savedParticipant = await em.save(
      MeetingExternalParticipantEntity,
      participant,
    );

    const event = em.create(MeetingEventEntity, {
      meetingId,
      eventType: MeetingEventType.EXTERNAL_PARTICIPANT_ADDED,
      actorUserId,
      sourceType: MeetingEventSourceType.MANUAL,
      description: `External participant ${data.email} added to meeting ${meetingId}`,
      metadataJson: {
        email: data.email,
        fullName: data.fullName,
      } as any,
    });
    await em.save(MeetingEventEntity, event);

    await em.save(AuditLogEntity, {
      userId: actorUserId,
      actionType: 'add_external_participant',
      entityType: 'meeting_external_participant',
      entityId: savedParticipant.id,
      newValueJson: {
        meetingId,
        email: data.email,
        fullName: data.fullName,
        organizationName: data.organizationName ?? null,
        phoneNumber: data.phoneNumber ?? null,
      } as any,
      ipAddress: clientContext.ipAddress ?? null,
      userAgent: clientContext.userAgent ?? null,
      severity: AuditLogSeverity.INFO,
    });

    return savedParticipant.id;
  }

  async addInternalParticipant(
    meetingId: string,
    dto: AddInternalParticipantDto,
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<IAddInternalParticipantResponse> {
    // ── Step 1: Pre-validation ──
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy cuộc họp',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }

    if (
      meeting.status !== MeetingStatus.SCHEDULED &&
      meeting.status !== MeetingStatus.IN_PROGRESS
    ) {
      throw new BadRequestException({
        success: false,
        message: 'Cuộc họp không ở trạng thái cho phép thêm thành viên',
        error: {
          code: 'INVALID_MEETING_STATUS',
          details: {
            currentStatus: meeting.status,
            allowedStatuses: ['scheduled', 'in_progress'],
          },
        },
      });
    }

    const invitedUser = await this.dataSource
      .getRepository(UserEntity)
      .findOne({
        where: { id: dto.userId },
      });

    if (!invitedUser || invitedUser.accountStatus !== AccountStatus.ACTIVE) {
      throw new NotFoundException({
        success: false,
        message: 'Người dùng không tồn tại hoặc không hoạt động',
        error: { code: 'USER_NOT_FOUND', details: {} },
      });
    }

    const existingParticipant = await this.dataSource
      .getRepository(MeetingParticipantEntity)
      .findOne({
        where: { meetingId, userId: dto.userId },
      });

    if (existingParticipant) {
      throw new ConflictException({
        success: false,
        message: 'Người dùng đã có trong danh sách tham gia cuộc họp',
        error: { code: 'PARTICIPANT_ALREADY_EXISTS', details: {} },
      });
    }

    const isOwner =
      meeting.organizerId === authUser.userId ||
      meeting.hostId === authUser.userId;

    if (
      meeting.visibilityLevel === MeetingVisibilityLevel.PRIVATE &&
      !isOwner
    ) {
      const isAdmin = await this.checkUserPermission(
        authUser.userId,
        'admin.all',
      );
      if (!isAdmin) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không có quyền thêm thành viên vào cuộc họp này',
          error: {
            code: 'FORBIDDEN_ACCESS',
            details: {
              reason:
                'Meeting là Private và bạn không phải Organizer/Host/Admin',
            },
          },
        });
      }
    }

    // ── Step 2: Warning check ──
    const warnings: Array<{ type: string; message: string }> = [];

    const conflictResult = await this.checkParticipantConflicts(
      [dto.userId],
      meeting.startTime,
      meeting.endTime,
    );

    for (const conflict of conflictResult.conflicts) {
      warnings.push({
        type: 'SCHEDULE_CONFLICT',
        message: `Người dùng đang có lịch bận từ ${conflict.busyFrom} đến ${conflict.busyTo}.`,
      });
    }

    if (meeting.roomId) {
      const attendeeCount = await this.getAttendeeCount(meetingId);
      const room = await this.dataSource.getRepository(RoomEntity).findOne({
        where: { id: meeting.roomId },
      });

      if (room && attendeeCount + 1 > room.capacity) {
        const capacityConfig = await this.dataSource
          .getRepository(SystemConfigEntity)
          .findOne({
            where: {
              configKey: 'meeting.capacity_policy',
              isActive: true,
            },
          });

        const capacityPolicy =
          (capacityConfig?.configValue as string) ?? 'warning';

        if (capacityPolicy === 'block') {
          throw new UnprocessableEntityException({
            success: false,
            message:
              'Phòng họp đã đạt sức chứa tối đa. Chính sách hiện tại không cho phép thêm người.',
            error: {
              code: 'ROOM_CAPACITY_EXCEEDED',
              details: {
                capacityPolicy: 'block',
                reason: "meeting.capacity_policy = 'block'",
              },
            },
          });
        }

        warnings.push({
          type: 'ROOM_CAPACITY_WARNING',
          message: `Sức chứa phòng (${room.capacity} người) không đủ cho tổng số người tham dự (${attendeeCount + 1} người).`,
        });
      }
    }

    if (
      warnings.length > 0 &&
      (dto.overrideWarnings !== true || !dto.warningToken)
    ) {
      const warningToken = this.warningTokenUtil.generateToken(
        meetingId,
        dto.userId,
        warnings,
      );

      throw new UnprocessableEntityException({
        success: false,
        message:
          'Phát hiện xung đột lịch hoặc cảnh báo sức chứa. Vui lòng xác nhận.',
        error: {
          code: 'WARNING_CONFIRMATION_REQUIRED',
          details: {
            warningToken,
            warnings,
          },
        },
      });
    }

    // ── Step 3: Override processing ──
    if (dto.overrideWarnings === true && dto.warningToken) {
      const verifyResult = this.warningTokenUtil.verifyToken(
        dto.warningToken,
        meetingId,
        dto.userId,
      );

      if (!verifyResult.valid) {
        throw new BadRequestException({
          success: false,
          message: 'warningToken không hợp lệ hoặc đã hết hạn',
          error: { code: 'INVALID_WARNING_TOKEN', details: {} },
        });
      }

      const hasCapacityWarning = (verifyResult.warnings ?? []).some(
        (w) => w.type === 'ROOM_CAPACITY_WARNING',
      );

      if (hasCapacityWarning) {
        const capacityConfig = await this.dataSource
          .getRepository(SystemConfigEntity)
          .findOne({
            where: {
              configKey: 'meeting.capacity_policy',
              isActive: true,
            },
          });

        const capacityPolicy =
          (capacityConfig?.configValue as string) ?? 'warning';

        if (capacityPolicy === 'block') {
          throw new UnprocessableEntityException({
            success: false,
            message:
              'Phòng họp đã đạt sức chứa tối đa. Chính sách hiện tại không cho phép thêm người.',
            error: {
              code: 'ROOM_CAPACITY_EXCEEDED',
              details: {
                capacityPolicy: 'block',
                reason: "meeting.capacity_policy = 'block'",
              },
            },
          });
        }

        const canOverride = await this.checkUserPermission(
          authUser.userId,
          'meeting.participant.override_capacity',
        );

        if (!canOverride) {
          throw new UnprocessableEntityException({
            success: false,
            message:
              'Phòng họp đã đạt sức chứa tối đa. Chính sách hiện tại không cho phép thêm người.',
            error: {
              code: 'ROOM_CAPACITY_EXCEEDED',
              details: {
                capacityPolicy: 'warning',
                reason: 'Người dùng không có quyền override_capacity',
              },
            },
          });
        }
      }
    }

    // ── Step 4: Transaction ──
    let participantId: string;

    try {
      participantId = await this.dataSource.transaction(async (em) =>
        this.persistInternalParticipantCore(
          em,
          meetingId,
          dto.userId,
          authUser.userId,
          clientContext,
        ),
      );
    } catch (error: unknown) {
      if (
        error instanceof ConflictException ||
        error instanceof UnprocessableEntityException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        `Transaction failed for addInternalParticipant: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }

    // ── Step 5: Post-transaction async (best-effort) ──
    try {
      // IN_APP notification for the added participant
      await this.notificationsService.createNotification({
        notificationType: NotificationType.MEETING_INVITE,
        channel: NotificationChannel.IN_APP,
        subject: `Lời mời tham gia cuộc họp: ${meeting.title}`,
        content: `Bạn đã được thêm vào cuộc họp "${meeting.title}".`,
        relatedEntityType: 'meeting',
        relatedEntityId: meetingId,
        recipientScope: 'user_list',
        recipientUserIds: [dto.userId],
        payloadJson: { invitedBy: authUser.userId },
        createdBy: authUser.userId,
      });

      // EMAIL to the added participant
      const emailMap = await this.resolveUserEmails(
        [dto.userId],
        this.dataSource.manager,
      );
      const userEmail = emailMap.get(dto.userId);
      if (userEmail) {
        await this.notificationsService.enqueueEmailNotification({
          notificationType: NotificationType.MEETING_INVITE,
          channel: NotificationChannel.EMAIL,
          subject: `Lời mời tham gia cuộc họp: ${meeting.title}`,
          content: `Bạn đã được thêm vào cuộc họp "${meeting.title}".`,
          toEmails: [userEmail],
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          recipientScope: 'user_list',
          payloadJson: { invitedBy: authUser.userId },
          createdBy: authUser.userId,
        });
      }
    } catch (notifError: unknown) {
      this.logger.error(
        `[addInternalParticipant] Failed to notify added participant: ${(notifError as Error).message}`,
      );
    }

    if (meeting.status === MeetingStatus.IN_PROGRESS) {
      this.logger.log(
        `[Device Sync] Meeting ${meetingId}: participant ${dto.userId} added. Device sync event emitted (best-effort).`,
      );
    }

    return {
      participantId,
      meetingId,
      userId: dto.userId,
      role: 'attendee',
      status: 'pending',
    };
  }

  // ════════════════════════════════════════════════════════════════
  //  My Schedule (UC-MM-05)
  // ════════════════════════════════════════════════════════════════

  async getMySchedule(
    userId: string,
    query: MyScheduleQueryDto,
  ): Promise<ScheduleResponseDto> {
    const { view, from, to, status, role, roomId, q } = query;

    // ── 1. Validate date range ──
    this.validateScheduleDateRange(view, from, to);

    const fromDate = new Date(from);
    const toDate = new Date(to);

    // ── 2. Build QueryBuilder ──
    const qb = this.dataSource
      .getRepository(MeetingEntity)
      .createQueryBuilder('m')
      .select([
        'm.id',
        'm.meetingCode',
        'm.title',
        'm.startTime',
        'm.endTime',
        'm.timezone',
        'm.status',
      ])
      .addSelect(
        `CASE WHEN m.organizer_id = :userId THEN 'organizer'
                   WHEN m.host_id = :userId THEN 'host'
                   ELSE 'attendee' END`,
        'effective_user_role',
      )
      .addSelect(
        `CASE WHEN NOW() BETWEEN m.start_time AND m.end_time THEN true ELSE false END`,
        'is_current',
      )
      .addSelect(
        `CASE WHEN m.end_time < NOW() THEN true ELSE false END`,
        'is_past',
      )
      .addSelect('r.id', 'room_id')
      .addSelect('r.room_name', 'room_name')
      .addSelect('r.room_code', 'room_code')
      .addSelect(
        `COALESCE(r.site_name || ', ' || r.area_name, r.location_description, '')`,
        'room_location',
      )
      .leftJoin(
        'meeting_participants',
        'mp',
        'mp.meeting_id = m.id AND mp.user_id = :userId',
        { userId },
      )
      .leftJoin('rooms', 'r', 'r.id = m.room_id')
      .where(
        '(m.organizer_id = :userId OR m.host_id = :userId OR mp.id IS NOT NULL)',
        { userId },
      )
      // Không loại trạng thái nào ở đây: khi client không truyền `status`,
      // lịch cá nhân phải trả TẤT CẢ trạng thái (kể cả draft/pending_approval)
      // — người đặt phòng cần thấy cuộc họp đang chờ duyệt để theo dõi/hủy.
      // Filter `status` tùy chọn ở dưới đã đủ để client tự thu hẹp khi cần.
      .andWhere('m.start_time < :to', { to: toDate })
      .andWhere('m.end_time > :from', { from: fromDate })
      .andWhere('m.deleted_at IS NULL')
      .orderBy('m.start_time', 'ASC');

    // Optional: status filter
    if (status && status.length > 0) {
      qb.andWhere('m.status IN (:...status)', { status });
    }

    // Optional: role filter
    if (role) {
      qb.andWhere(
        `CASE WHEN m.organizer_id = :userId2 THEN 'organizer'
                   WHEN m.host_id = :userId2 THEN 'host'
                   ELSE 'attendee' END = :role`,
        { userId2: userId, role },
      );
    }

    // Optional: roomId filter
    if (roomId) {
      qb.andWhere('m.room_id = :roomId', { roomId });
    }

    // Optional: q search (ILIKE on title and meeting_code)
    const normalizedQ = this.normalizeSearchQuery(q);
    if (normalizedQ) {
      qb.andWhere('(m.title ILIKE :q OR m.meeting_code ILIKE :q)', {
        q: normalizedQ,
      });
    }

    // ── 3. Execute query ──
    let rawResults: any[];
    try {
      rawResults = await qb.getRawMany();
    } catch (err) {
      this.logger.error(
        `getMySchedule query failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }

    // ── 4. Map to DTOs ──
    const items = rawResults.map((row) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const room: ScheduleRoomDto | null = row.room_id
        ? new ScheduleRoomDto({
            id: row.room_id,
            roomName: row.room_name ?? '',
            roomCode: row.room_code ?? '',
            location: row.room_location ?? '',
          })
        : null;

      const startTime =
        row.m_start_time instanceof Date
          ? row.m_start_time.toISOString()
          : new Date(row.m_start_time).toISOString();
      const endTime =
        row.m_end_time instanceof Date
          ? row.m_end_time.toISOString()
          : new Date(row.m_end_time).toISOString();
      const isCurrent = row.is_current === true || row.is_current === 'true';
      const isPast = row.is_past === true || row.is_past === 'true';

      return new ScheduleEventDto({
        meetingId: row.m_id,
        meetingCode: row.m_meeting_code,
        title: row.m_title,
        startTime,
        endTime,
        timezone: row.m_timezone ?? 'Asia/Ho_Chi_Minh',
        status: row.m_status,
        userRole: row.effective_user_role as 'organizer' | 'host' | 'attendee',
        room,
        colorKey: row.m_status,
        isCurrent,
        isPast,
      });
    });

    // ── 5. Build response ──
    return new ScheduleResponseDto({
      items,
      range: new ScheduleRangeDto({
        view,
        from,
        to,
        timezone: query.timezone ?? 'Asia/Ho_Chi_Minh',
      }),
      empty: items.length === 0,
    });
  }

  async getMyScheduleDetail(
    userId: string,
    meetingId: string,
  ): Promise<MyScheduleDetailDto> {
    // ── 1. Load meeting with organizer and host ──
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
      relations: { organizer: true, host: true },
    });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay cuoc hop',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }

    // ── 2. Access check ──
    const isOrganizer = meeting.organizerId === userId;
    const isHost = meeting.hostId === userId;

    let isParticipant = false;
    if (!isOrganizer && !isHost) {
      const participant = await this.dataSource
        .getRepository(MeetingParticipantEntity)
        .findOne({
          where: { meetingId, userId },
        });
      isParticipant = !!participant;
    }

    if (!isOrganizer && !isHost && !isParticipant) {
      throw new ForbiddenException({
        success: false,
        message: 'Ban khong co quyen xem cuoc hop nay',
        error: { code: 'FORBIDDEN_NOT_PARTICIPANT', details: { meetingId } },
      });
    }

    // ── 3. Compute effectiveUserRole ──
    const userRole = this.resolveEffectiveUserRole(
      meeting.organizerId,
      meeting.hostId,
      userId,
    );

    // ── 4. Load related data in parallel ──
    const [
      room,
      participants,
      externalParticipants,
      agendas,
      attachments,
      recordingConfig,
    ] = await Promise.all([
      // Room info
      meeting.roomId
        ? this.dataSource
            .getRepository(RoomEntity)
            .findOne({ where: { id: meeting.roomId } })
        : Promise.resolve(null),

      // Participants list
      this.dataSource.getRepository(MeetingParticipantEntity).find({
        where: { meetingId },
        relations: { user: true },
        order: { participantRole: 'ASC' },
      }),

      // External participants
      this.dataSource
        .getRepository(MeetingExternalParticipantEntity)
        .find({ where: { meetingId } }),

      // Agendas
      this.dataSource
        .getRepository(MeetingAgendaEntity)
        .find({ where: { meetingId }, order: { agendaOrder: 'ASC' } }),

      // Attachments (media_files)
      this.dataSource.getRepository(MediaFileEntity).find({
        where: {
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          isActive: true,
        },
      }),

      // Recording config
      this.dataSource
        .getRepository(RecordingConfigEntity)
        .findOne({ where: { meetingId } }),
    ]);

    // ── 5. Assemble DTO ──
    return new MyScheduleDetailDto({
      meeting: new DetailMeetingDto({
        meetingId: meeting.id,
        meetingCode: meeting.meetingCode,
        title: meeting.title,
        description: meeting.description,
        startTime: meeting.startTime.toISOString(),
        endTime: meeting.endTime.toISOString(),
        timezone: meeting.timezone,
        status: meeting.status,
        recurrenceRuleId: meeting.recurrenceRuleId,
        parentMeetingId: meeting.parentMeetingId,
      }),
      room: room
        ? new DetailRoomDto({
            id: room.id,
            roomName: room.roomName,
            roomCode: room.roomCode,
            siteName: room.siteName ?? null,
            areaName: room.areaName ?? null,
            location: room.locationDescription ?? null,
            hasMicrophone: room.hasMicrophone,
            allowRecording: room.allowRecording,
          })
        : null,
      organizer: new DetailUserDto({
        id: meeting.organizer?.id ?? meeting.organizerId,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
        fullName: (meeting.organizer as any)?.fullName ?? '',
        email: (meeting.organizer as any)?.email ?? '',
      }),
      host: meeting.host
        ? new DetailUserDto({
            id: meeting.host.id,
            fullName: meeting.host.fullName,
            email: meeting.host.email,
          })
        : null,
      participants: (participants ?? []).map(
        (p) =>
          new DetailParticipantDto({
            id: p.id,
            userId: p.userId,
            fullName: (p.user as any)?.fullName ?? '',
            email: (p.user as any)?.email ?? '',
            participantRole: p.participantRole,
            invitationStatus: p.invitationStatus,
            attendanceStatus: p.attendanceStatus,
          }),
      ),
      externalParticipants: (externalParticipants ?? []).map(
        (ep) =>
          new DetailExternalParticipantDto({
            name: (ep as any).fullName ?? (ep as any).name ?? '',
            email: ep.email ?? '',
          }),
      ),
      agendas: (agendas ?? []).map(
        (a) =>
          new DetailAgendaDto({
            id: a.id,
            title: a.title,
            durationMinutes: a.plannedDurationMinutes,
            sortOrder: a.agendaOrder,
          }),
      ),
      attachments: (attachments ?? []).map(
        (a) =>
          new DetailAttachmentDto({
            id: a.id,
            fileName: a.fileName,
            fileUrl: a.fileUrl,
            fileType: a.fileType,
            fileSize: a.fileSizeBytes?.toString() ?? null,
          }),
      ),
      recordingConfig: recordingConfig
        ? new DetailRecordingConfigDto({
            autoRecord: recordingConfig.autoStart,
            allowRecording:
              recordingConfig.enableVideo || recordingConfig.enableAudio,
            enableTranscription: recordingConfig.enableTranscription,
          })
        : null,
      userRole,
    });
  }

  // ── Private helpers ──

  private validateScheduleDateRange(
    view: string,
    from: string,
    to: string,
  ): void {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException({
        success: false,
        message: 'from hoac to khong dung dinh dang ISO',
        error: { code: 'INVALID_DATETIME_FORMAT', details: {} },
      });
    }

    if (fromDate >= toDate) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Khoang thoi gian khong hop le: from phai truoc to',
        error: {
          code: 'INVALID_DATE_RANGE',
          details: { from, to },
        },
      });
    }

    const diffMs = toDate.getTime() - fromDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    const maxDays: Record<string, number> = {
      day: 1,
      week: 7,
      month: 31,
    };

    const limit = maxDays[view];
    if (limit && diffDays > limit) {
      throw new UnprocessableEntityException({
        success: false,
        message: `Khoang thoi gian qua rong cho view ${view}: toi da ${limit} ngay`,
        error: {
          code: 'DATE_RANGE_TOO_WIDE',
          details: { maxDays: limit, view, actualDays: Math.ceil(diffDays) },
        },
      });
    }
  }

  private resolveEffectiveUserRole(
    organizerId: string,
    hostId: string | null,
    userId: string,
  ): 'organizer' | 'host' | 'attendee' {
    if (organizerId === userId) return 'organizer';
    if (hostId === userId) return 'host';
    return 'attendee';
  }

  private normalizeSearchQuery(q: string | undefined): string | null {
    if (!q) return null;
    const trimmed = q.trim();
    if (trimmed.length === 0) return null;
    return `%${trimmed}%`;
  }
  async checkUserPermission(
    userId: string,
    permissionCode: string,
  ): Promise<boolean> {
    try {
      const result = await this.dataSource
        .getRepository(UserEntity)
        .createQueryBuilder('u')
        .innerJoin(UserRoleEntity, 'ur', 'ur.userId = u.id')
        .innerJoin('roles', 'r', 'r.id = ur.roleId')
        .innerJoin('role_permissions', 'rp', 'rp.role_id = r.id')
        .innerJoin('permissions', 'p', 'p.id = rp.permission_id')
        .where('u.id = :userId', { userId })
        .andWhere('p.permissionCode = :permCode', { permissionCode })
        .andWhere('ur.isActive = :isActive', { isActive: true })
        .andWhere('(ur.expiredAt IS NULL OR ur.expiredAt > NOW())')
        .getOne();

      return !!result;
    } catch {
      return false;
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Remove Internal Meeting Participant (UC-MM-08)
  // ════════════════════════════════════════════════════════════════

  /**
   * Gỡ bỏ internal participant khỏi cuộc họp.
   * Chỉ áp dụng cho meeting ở trạng thái scheduled.
   * Không được gỡ Host/Organizer (kể cả Admin).
   * Không được gỡ participant đang là owner của agenda items.
   * Chỉ áp dụng cho một meeting instance cụ thể (FR-019).
   * Nếu body.scope = 'series' → reject với 422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED (FR-020).
   */
  async removeParticipant(
    meetingId: string,
    participantUserId: string,
    authUser: AuthUser,
    clientContext: ClientContext,
    body?: RemoveParticipantBodyDto,
  ): Promise<RemoveParticipantResponseDto> {
    // ── Step 1: Pre-validation ──
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy cuộc họp',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }

    if (meeting.status !== MeetingStatus.SCHEDULED) {
      throw new ConflictException({
        success: false,
        message:
          'Không thể gỡ thành viên: cuộc họp không ở trạng thái scheduled',
        error: {
          code: 'MEETING_NOT_REMOVABLE',
          details: { currentStatus: meeting.status },
        },
      });
    }

    // ── Step 2: Authorization check ──
    const isOwner =
      meeting.organizerId === authUser.userId ||
      meeting.hostId === authUser.userId;
    const hasPermission = await this.checkUserPermission(
      authUser.userId,
      'meeting.participant.remove',
    );

    if (!isOwner && !hasPermission) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền gỡ thành viên khỏi cuộc họp này',
        error: { code: 'FORBIDDEN', details: {} },
      });
    }

    // ── Step 3: Participant existence check ──
    const participant = await this.dataSource
      .getRepository(MeetingParticipantEntity)
      .findOne({
        where: { meetingId, userId: participantUserId },
      });

    if (!participant) {
      throw new NotFoundException({
        success: false,
        message: 'Thành viên không có trong cuộc họp này',
        error: { code: 'PARTICIPANT_NOT_IN_MEETING', details: {} },
      });
    }

    // ── Step 4: Host/Organizer protection check ──
    const isTargetHost = meeting.hostId === participantUserId;
    const isTargetOrganizer = meeting.organizerId === participantUserId;

    if (isTargetHost || isTargetOrganizer) {
      throw new ConflictException({
        success: false,
        message: 'Không thể gỡ Host hoặc Organizer khỏi cuộc họp',
        error: {
          code: 'CANNOT_REMOVE_HOST_OR_ORGANIZER',
          details: {
            targetRole: isTargetHost ? 'host' : 'organizer',
          },
        },
      });
    }

    // ── Step 5: Agenda owner check ──
    const ownedAgendas = await this.dataSource
      .getRepository(MeetingAgendaEntity)
      .find({
        where: { meetingId, ownerId: participantUserId },
        select: { id: true },
      });

    if (ownedAgendas.length > 0) {
      throw new ConflictException({
        success: false,
        message:
          'Thành viên đang là chủ sở hữu của một hoặc nhiều agenda items và không thể bị gỡ trước khi chuyển quyền sở hữu.',
        error: {
          code: 'PARTICIPANT_OWNS_AGENDA_ITEMS',
          details: {
            agendaItemIds: ownedAgendas.map((a) => a.id),
          },
        },
      });
    }

    // ── Step 6: Recurring scope check ──
    const scope = body?.scope ?? RemoveScope.INSTANCE;
    if (scope === RemoveScope.SERIES) {
      throw new UnprocessableEntityException({
        success: false,
        message:
          'Không thể gỡ thành viên khỏi toàn bộ recurring series. Chỉ hỗ trợ gỡ trên một instance cụ thể.',
        error: {
          code: 'RECURRING_SERIES_SCOPE_NOT_SUPPORTED',
          details: {},
        },
      });
    }

    // ── Step 7: Transaction ──
    let removedAt!: Date;

    try {
      await this.dataSource.transaction(async (em) => {
        // Pessimistic lock on meeting row
        await em.findOne(MeetingEntity, {
          where: { id: meetingId },
          lock: { mode: 'pessimistic_write' },
        });

        // Double-check participant still exists inside transaction
        const dupCheck = await em.findOne(MeetingParticipantEntity, {
          where: { meetingId, userId: participantUserId },
        });

        if (!dupCheck) {
          throw new NotFoundException({
            success: false,
            message: 'Thành viên không có trong cuộc họp này',
            error: { code: 'PARTICIPANT_NOT_IN_MEETING', details: {} },
          });
        }

        // 7a: Hard delete participant row
        await em.delete(MeetingParticipantEntity, {
          meetingId,
          userId: participantUserId,
        });

        // 7b: Insert meeting event
        const event = em.create(MeetingEventEntity, {
          meetingId,
          eventType: MeetingEventType.PARTICIPANT_REMOVED,
          actorUserId: authUser.userId,
          sourceType: MeetingEventSourceType.MANUAL,
          description: `Participant ${participantUserId} removed from meeting ${meetingId}`,
          metadataJson: {
            removedUserId: participantUserId,
            removedByUserId: authUser.userId,
            reason: body?.reason ?? null,
          } as any,
        });
        await em.save(MeetingEventEntity, event);

        // 7c: Insert audit log
        await em.save(AuditLogEntity, {
          userId: authUser.userId,
          actionType: 'remove_participant',
          entityType: 'meeting_participant',
          entityId: participantUserId,
          oldValueJson: {
            meetingId,
            participantRole: participant.participantRole,
          } as any,
          newValueJson: {
            removed: true,
            removedAt: new Date(),
            reason: body?.reason ?? null,
          } as any,
          ipAddress: clientContext.ipAddress ?? null,
          userAgent: clientContext.userAgent ?? null,
          severity: AuditLogSeverity.INFO,
        });

        removedAt = new Date();

        this.logger.log(
          `[RemoveParticipant] Meeting ${meetingId}: participant ${participantUserId} removed by ${authUser.userId}`,
        );
      });
    } catch (error: unknown) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof UnprocessableEntityException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        `Transaction failed for removeParticipant: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }

    // ── Post-transaction: notify removed participant (best-effort) ──
    let notificationId = '';
    let backgroundJobId = '';

    try {
      // IN_APP notification for the removed participant
      const notif = await this.notificationsService.createNotification({
        notificationType: NotificationType.MEETING_PARTICIPANT_REMOVED,
        channel: NotificationChannel.IN_APP,
        subject: 'Bạn đã bị gỡ khỏi cuộc họp',
        content: `Bạn đã bị gỡ khỏi cuộc họp "${meeting.title}".`,
        relatedEntityType: 'meeting',
        relatedEntityId: meetingId,
        recipientScope: 'user_list',
        recipientUserIds: [participantUserId],
        payloadJson: {
          removedBy: authUser.userId,
          reason: body?.reason ?? null,
        },
        createdBy: authUser.userId,
      });
      notificationId = notif.id;

      // EMAIL to the removed participant
      const emailMap = await this.resolveUserEmails(
        [participantUserId],
        this.dataSource.manager,
      );
      const userEmail = emailMap.get(participantUserId);
      if (userEmail) {
        const emailResult =
          await this.notificationsService.enqueueEmailNotification({
            notificationType: NotificationType.MEETING_PARTICIPANT_REMOVED,
            channel: NotificationChannel.EMAIL,
            subject: 'Bạn đã bị gỡ khỏi cuộc họp',
            content: `Bạn đã bị gỡ khỏi cuộc họp "${meeting.title}".`,
            toEmails: [userEmail],
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            recipientScope: 'user_list',
            payloadJson: {
              removedBy: authUser.userId,
              reason: body?.reason ?? null,
            },
            createdBy: authUser.userId,
          });
        if (emailResult.jobId) {
          backgroundJobId = emailResult.jobId;
        }
      }
    } catch (notifError: unknown) {
      this.logger.error(
        `[removeParticipant] Failed to notify removed participant for meeting ${meetingId}: ${(notifError as Error).message}`,
      );
    }

    // ── Step 8: Build response ──
    return new RemoveParticipantResponseDto({
      meetingId,
      removedParticipantUserId: participantUserId,
      removed: true,
      removedAt,
      notificationQueued: true,
      notificationId,
      backgroundJobId,
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  Add External Meeting Participant (MEET-ADD-EXTERNAL-PARTICIPANT-001)
  // ════════════════════════════════════════════════════════════════

  /**
   * Thêm khách mời bên ngoài vào cuộc họp đã tạo.
   * Cho phép Organizer/Host/Manager có quyền `meeting.participant.add.external`.
   * Chỉ áp dụng cho meeting ở trạng thái scheduled hoặc in_progress.
   * Kiểm tra sức chứa phòng, duplicate email, và ghi event/audit log trong transaction.
   * Gửi email invite best-effort sau transaction.
   */
  async addExternalParticipant(
    meetingId: string,
    dto: AddExternalParticipantDto,
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<IAddExternalParticipantResponse> {
    // ── Step 1: Meeting existence check ──
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy cuộc họp',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }

    // ── Step 2: State validation ──
    if (
      meeting.status !== MeetingStatus.SCHEDULED &&
      meeting.status !== MeetingStatus.IN_PROGRESS
    ) {
      throw new BadRequestException({
        success: false,
        message: 'Cuộc họp không ở trạng thái scheduled hoặc in_progress',
        error: {
          code: 'INVALID_MEETING_STATUS',
          details: { currentStatus: meeting.status },
        },
      });
    }

    // ── Step 3: Authorization check ──
    const isOwner =
      meeting.organizerId === authUser.userId ||
      meeting.hostId === authUser.userId;
    const hasPermission = await this.checkUserPermission(
      authUser.userId,
      'meeting.participant.add.external',
    );

    if (!isOwner && !hasPermission) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền thêm khách mời bên ngoài vào cuộc họp này',
        error: { code: 'FORBIDDEN', details: {} },
      });
    }

    // ── Step 4: Private meeting check ──
    if (
      meeting.visibilityLevel === MeetingVisibilityLevel.PRIVATE &&
      !isOwner
    ) {
      const hasAdminAll = await this.checkUserPermission(
        authUser.userId,
        'admin.all',
      );
      if (!hasAdminAll) {
        throw new ForbiddenException({
          success: false,
          message:
            'Cuộc họp riêng tư: chỉ Organizer/Host/Admin mới được thêm khách mời',
          error: { code: 'FORBIDDEN_ACCESS', details: {} },
        });
      }
    }

    // ── Step 5: Duplicate email pre-check (case-insensitive) ──
    const existingExternal = await this.dataSource
      .getRepository(MeetingExternalParticipantEntity)
      .createQueryBuilder('ep')
      .where('ep.meetingId = :meetingId AND LOWER(ep.email) = LOWER(:email)', {
        meetingId,
        email: dto.email,
      })
      .getOne();

    if (existingExternal) {
      throw new ConflictException({
        success: false,
        message: 'Email khách mời đã tồn tại trong cuộc họp này',
        error: { code: 'EXTERNAL_PARTICIPANT_ALREADY_EXISTS', details: {} },
      });
    }

    // ── Step 6: Room capacity check (nếu có roomId) ──
    const capacityWarnings: WarningItem[] = [];
    let warningTokenFromCapacity: string | null = null;

    if (meeting.roomId) {
      const attendeeCount = await this.getAttendeeCount(meetingId);
      const room = await this.dataSource.getRepository(RoomEntity).findOne({
        where: { id: meeting.roomId },
      });

      if (room && attendeeCount + 1 > room.capacity) {
        // Read capacity policy
        const config = await this.dataSource
          .getRepository(SystemConfigEntity)
          .findOne({
            where: { configKey: 'meeting.capacity_policy', isActive: true },
          });
        const policy = config?.configValue ?? 'warning';

        if (policy === 'block') {
          throw new UnprocessableEntityException({
            success: false,
            message: 'Sức chứa phòng không đủ. Chính sách hiện tại là block.',
            error: {
              code: 'ROOM_CAPACITY_EXCEEDED',
              details: {
                capacity: room.capacity,
                attendeeCount: attendeeCount + 1,
              },
            },
          });
        }

        // policy === 'warning'
        capacityWarnings.push({
          type: 'ROOM_CAPACITY_WARNING',
          message: `Sức chứa phòng (${room.capacity} người) không đủ cho tổng số người tham dự (${attendeeCount + 1} người).`,
        });

        // Check if override was provided
        if (!dto.overrideWarnings || !dto.warningToken) {
          warningTokenFromCapacity = this.warningTokenUtil.generateToken(
            meetingId,
            dto.email,
            capacityWarnings,
          );

          throw new UnprocessableEntityException({
            success: false,
            message: 'Phát hiện cảnh báo sức chứa phòng. Vui lòng xác nhận.',
            error: {
              code: 'WARNING_CONFIRMATION_REQUIRED',
              details: {
                warningToken: warningTokenFromCapacity,
                warnings: capacityWarnings,
              },
            },
          });
        }

        // Verify warning token
        const verifyResult = this.warningTokenUtil.verifyToken(
          dto.warningToken,
          meetingId,
          dto.email,
        );

        if (!verifyResult.valid) {
          throw new BadRequestException({
            success: false,
            message: 'Warning token không hợp lệ hoặc đã hết hạn',
            error: { code: 'INVALID_WARNING_TOKEN', details: {} },
          });
        }

        // Check override capacity permission if ROOM_CAPACITY_WARNING is present
        if (capacityWarnings.some((w) => w.type === 'ROOM_CAPACITY_WARNING')) {
          const hasOverridePermission = await this.checkUserPermission(
            authUser.userId,
            'meeting.participant.override_capacity',
          );

          if (!hasOverridePermission) {
            throw new UnprocessableEntityException({
              success: false,
              message: 'Bạn không có quyền ghi đè cảnh báo sức chứa phòng',
              error: {
                code: 'ROOM_CAPACITY_EXCEEDED',
                details: {
                  capacity: room.capacity,
                  attendeeCount: attendeeCount + 1,
                },
              },
            });
          }
        }
      }
    }

    // ── Step 7: Transaction ──
    let createdParticipantId!: string;

    try {
      await this.dataSource.transaction(async (em) => {
        createdParticipantId = await this.persistExternalParticipantCore(
          em,
          meetingId,
          {
            fullName: dto.fullName,
            email: dto.email,
            organizationName: dto.organizationName ?? null,
            phoneNumber: dto.phoneNumber ?? null,
          },
          authUser.userId,
          clientContext,
        );
      });
    } catch (error: unknown) {
      if (
        error instanceof ConflictException ||
        error instanceof UnprocessableEntityException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        `Transaction failed for addExternalParticipant: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }

    // ── Step 8: Post-transaction notification (best-effort) ──
    try {
      // EMAIL notification only — NO in-app notification for external
      await this.notificationsService.enqueueEmailNotification({
        notificationType: NotificationType.MEETING_INVITE,
        channel: NotificationChannel.EMAIL,
        subject: `Lời mời tham gia cuộc họp: ${meeting.title}`,
        content: `Bạn đã được thêm vào cuộc họp "${meeting.title}".`,
        toEmails: [dto.email],
        relatedEntityType: 'meeting',
        relatedEntityId: meetingId,
        recipientScope: 'user_list',
        payloadJson: { invitedBy: authUser.userId },
        createdBy: authUser.userId,
      });
    } catch (notifError: unknown) {
      this.logger.error(
        `[addExternalParticipant] Failed to notify external participant: ${(notifError as Error).message}`,
      );
    }

    // Best-effort device sync log if in_progress
    if (meeting.status === MeetingStatus.IN_PROGRESS) {
      this.logger.log(
        `[Device Sync] Meeting ${meetingId}: external participant ${dto.email} added while in_progress (best-effort).`,
      );
    }

    // ── Step 9: Build response ──
    return {
      externalParticipantId: createdParticipantId,
      meetingId,
      fullName: dto.fullName,
      email: dto.email,
      organizationName: dto.organizationName ?? null,
      phoneNumber: dto.phoneNumber ?? null,
      role: 'attendee',
      status: 'pending',
    };
  }

  // ════════════════════════════════════════════════════════════════
  //  Remove External Meeting Participant (MEET-REMOVE-EXTERNAL-PARTICIPANT-001)
  // ════════════════════════════════════════════════════════════════

  /**
   * Gỡ bỏ khách mời bên ngoài khỏi cuộc họp.
   * Chỉ áp dụng cho meeting ở trạng thái scheduled.
   * Hard delete row + ghi event/audit log trong transaction.
   * Gửi email thông báo best-effort sau transaction (nếu có email).
   * Không cần Host/Organizer protection check và agenda-owner check
   * vì external participant không thể giữ các vai trò đó.
   */
  async removeExternalParticipant(
    meetingId: string,
    externalParticipantId: string,
    authUser: AuthUser,
    clientContext: ClientContext,
    body?: RemoveExternalParticipantBodyDto,
  ): Promise<RemoveExternalParticipantResponseDto> {
    // ── Step 1: Meeting existence check ──
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy cuộc họp',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }

    // ── Step 2: State validation — only scheduled ──
    if (meeting.status !== MeetingStatus.SCHEDULED) {
      throw new ConflictException({
        success: false,
        message:
          'Không thể gỡ khách mời: cuộc họp không ở trạng thái scheduled',
        error: {
          code: 'MEETING_NOT_REMOVABLE',
          details: { currentStatus: meeting.status },
        },
      });
    }

    // ── Step 3: Authorization check ──
    const isOwner =
      meeting.organizerId === authUser.userId ||
      meeting.hostId === authUser.userId;
    const hasPermission = await this.checkUserPermission(
      authUser.userId,
      'meeting.participant.remove.external',
    );

    if (!isOwner && !hasPermission) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền gỡ khách mời bên ngoài khỏi cuộc họp này',
        error: { code: 'FORBIDDEN', details: {} },
      });
    }

    // ── Step 4: Target lookup ──
    const target = await this.dataSource
      .getRepository(MeetingExternalParticipantEntity)
      .findOne({
        where: { id: externalParticipantId, meetingId },
      });

    if (!target) {
      throw new NotFoundException({
        success: false,
        message: 'Khách mời bên ngoài không có trong cuộc họp này',
        error: { code: 'EXTERNAL_PARTICIPANT_NOT_IN_MEETING', details: {} },
      });
    }

    // ── Step 5: Recurring scope check ──
    const scope = body?.scope ?? RemoveScope.INSTANCE;
    if (scope === RemoveScope.SERIES) {
      throw new UnprocessableEntityException({
        success: false,
        message:
          'Không thể gỡ khách mời khỏi toàn bộ recurring series. Chỉ hỗ trợ gỡ trên một instance cụ thể.',
        error: {
          code: 'RECURRING_SERIES_SCOPE_NOT_SUPPORTED',
          details: {},
        },
      });
    }

    // ── Step 6: Transaction (lock + re-check + delete + event + audit) ──
    let removedAt!: Date;
    const targetEmail = target.email; // capture for post-transaction

    try {
      await this.dataSource.transaction(async (em) => {
        // Pessimistic lock on meeting row
        await em.findOne(MeetingEntity, {
          where: { id: meetingId },
          lock: { mode: 'pessimistic_write' },
        });

        // Re-check target still exists inside transaction
        const reCheck = await em.findOne(MeetingExternalParticipantEntity, {
          where: { id: externalParticipantId, meetingId },
        });

        if (!reCheck) {
          throw new NotFoundException({
            success: false,
            message: 'Khách mời bên ngoài không có trong cuộc họp này',
            error: { code: 'EXTERNAL_PARTICIPANT_NOT_IN_MEETING', details: {} },
          });
        }

        // 6a: Hard delete participant row
        await em.delete(MeetingExternalParticipantEntity, {
          id: externalParticipantId,
          meetingId,
        });

        // 6b: Insert meeting event
        const event = em.create(MeetingEventEntity, {
          meetingId,
          eventType: MeetingEventType.EXTERNAL_PARTICIPANT_REMOVED,
          actorUserId: authUser.userId,
          sourceType: MeetingEventSourceType.MANUAL,
          description: `External participant ${target.email} removed from meeting ${meetingId}`,
          metadataJson: {
            removedExternalParticipantId: externalParticipantId,
            removedByUserId: authUser.userId,
            reason: body?.reason ?? null,
          } as any,
        });
        await em.save(MeetingEventEntity, event);

        // 6c: Insert audit log
        await em.save(AuditLogEntity, {
          userId: authUser.userId,
          actionType: 'remove_external_participant',
          entityType: 'meeting_external_participant',
          entityId: externalParticipantId,
          oldValueJson: {
            meetingId,
            fullName: target.fullName,
            email: target.email,
          } as any,
          newValueJson: {
            removed: true,
            removedAt: new Date(),
            reason: body?.reason ?? null,
          } as any,
          ipAddress: clientContext.ipAddress ?? null,
          userAgent: clientContext.userAgent ?? null,
          severity: AuditLogSeverity.INFO,
        });

        removedAt = new Date();

        this.logger.log(
          `[RemoveExternalParticipant] Meeting ${meetingId}: external participant ${externalParticipantId} removed by ${authUser.userId}`,
        );
      });
    } catch (error: unknown) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof UnprocessableEntityException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        `Transaction failed for removeExternalParticipant: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }

    // ── Step 7: Post-transaction notification (best-effort) ──
    let notificationId: string | null = null;
    let backgroundJobId: string | null = null;
    let notificationQueued = false;

    try {
      if (targetEmail) {
        const emailResult =
          await this.notificationsService.enqueueEmailNotification({
            notificationType: NotificationType.MEETING_PARTICIPANT_REMOVED,
            channel: NotificationChannel.EMAIL,
            subject: 'Bạn đã bị gỡ khỏi cuộc họp',
            content: `Bạn đã bị gỡ khỏi cuộc họp "${meeting.title}".`,
            toEmails: [targetEmail],
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            recipientScope: 'user_list',
            payloadJson: {
              removedBy: authUser.userId,
              reason: body?.reason ?? null,
            },
            createdBy: authUser.userId,
          });
        notificationId = emailResult.notification.id;
        backgroundJobId = emailResult.jobId ?? null;
        notificationQueued = true;
      } else {
        this.logger.log(
          `[RemoveExternalParticipant] Skipped email notification for ${externalParticipantId} — no email on file.`,
        );
      }
    } catch (notifError: unknown) {
      this.logger.error(
        `[RemoveExternalParticipant] Failed to notify removed external participant: ${(notifError as Error).message}`,
      );
    }

    // ── Step 8: Build response ──
    return new RemoveExternalParticipantResponseDto({
      meetingId,
      removedExternalParticipantId: externalParticipantId,
      removed: true,
      removedAt,
      notificationQueued,
      notificationId,
      backgroundJobId,
    });
  }
  private async resolveApproverIds(): Promise<string[]> {
    try {
      const config = await this.dataSource
        .getRepository(SystemConfigEntity)
        .findOne({
          where: { configKey: 'meeting.approver_role_id', isActive: true },
        });

      if (config?.configValue) {
        const usersWithRole = await this.dataSource
          .getRepository(UserRoleEntity)
          .createQueryBuilder('ur')
          .innerJoin('ur.role', 'r')
          .where('r.id = :roleId', { roleId: config.configValue })
          .andWhere('ur.isActive = :isActive', { isActive: true })
          .andWhere('(ur.expiredAt IS NULL OR ur.expiredAt > now())')
          .select('ur.userId')
          .getMany();

        if (usersWithRole.length > 0) {
          return usersWithRole.map((ur) => ur.userId);
        }
      }

      const approverUsers = await this.dataSource
        .getRepository(UserEntity)
        .createQueryBuilder('u')
        .innerJoin(UserRoleEntity, 'ur', 'ur.userId = u.id')
        .innerJoin('roles', 'r', 'r.id = ur.roleId')
        .innerJoin('role_permissions', 'rp', 'rp.role_id = r.id')
        .innerJoin('permissions', 'p', 'p.id = rp.permission_id')
        .where('p.permissionCode = :permCode', {
          permCode: 'meeting_request.approve',
        })
        .andWhere('u.accountStatus = :active', { active: 'active' })
        .andWhere('ur.isActive = :isActive', { isActive: true })
        .andWhere('(ur.expiredAt IS NULL OR ur.expiredAt > now())')
        .select('u.id')
        .distinct(true)
        .getMany();

      return approverUsers.map((u) => u.id);
    } catch (error) {
      this.logger.warn(
        `Failed to resolve approver IDs: ${(error as Error).message}`,
      );
      return [];
    }
  }

  // ────────────────────────────────────────────────────────────
  // Agenda feature (UC-MM-09)
  // ────────────────────────────────────────────────────────────

  /**
   * Check if user has read permission for meeting agenda.
   * User must be organizer, host, or internal participant.
   */
  private async checkAgendaReadPermission(
    meetingId: string,
    userId: string,
  ): Promise<MeetingEntity> {
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });
    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException('MEETING_NOT_FOUND');
    }
    // Organizer or host always has read access
    if (meeting.organizerId === userId || meeting.hostId === userId) {
      return meeting;
    }
    // Internal participants have read access
    const participant = await this.dataSource
      .getRepository(MeetingParticipantEntity)
      .findOne({
        where: { meetingId: meeting.id, userId },
      });
    if (!participant) {
      throw new ForbiddenException('AGENDA_READ_FORBIDDEN');
    }
    return meeting;
  }

  /**
   * Verify user has write permission for meeting agenda.
   * Only organizer (meetings.organizer_id) or host (meetings.host_id).
   * Does NOT use participant_role.
   */
  private checkAgendaWritePermission(
    meeting: MeetingEntity,
    userId: string,
  ): void {
    if (meeting.organizerId !== userId && meeting.hostId !== userId) {
      throw new ForbiddenException('AGENDA_WRITE_FORBIDDEN');
    }
  }

  /**
   * Validate meeting time is valid for agenda operations.
   */
  private validateMeetingTimeForAgenda(meeting: MeetingEntity): void {
    if (
      !meeting.startTime ||
      !meeting.endTime ||
      meeting.endTime <= meeting.startTime
    ) {
      throw new ConflictException('MEETING_TIME_INVALID_FOR_AGENDA');
    }
  }

  /**
   * Validate meeting status allows agenda editing.
   * 'pending_approval' and 'scheduled' both permit write operations, matching
   * the same convention as updateMeetingTime/updateMeetingRoom/participants
   * (organizer can prepare the meeting, including agenda, before approval).
   */
  private validateMeetingStatusForAgendaWrite(meeting: MeetingEntity): void {
    if (
      meeting.status !== MeetingStatus.PENDING_APPROVAL &&
      meeting.status !== MeetingStatus.SCHEDULED
    ) {
      throw new ConflictException('AGENDA_MEETING_STATUS_BLOCKED');
    }
  }

  /**
   * Calculate meeting duration in minutes from start/end time.
   */
  private getMeetingDurationMinutes(meeting: MeetingEntity): number {
    const diffMs = meeting.endTime.getTime() - meeting.startTime.getTime();
    return Math.floor(diffMs / 60000);
  }

  // ── T005: GET Agendas ──────────────────────────────────────

  /**
   * Get agenda list for a meeting.
   * Returns sorted items with metadata (durationStatus, isLockedForEditing).
   */
  async getAgendas(
    meetingId: string,
    userId: string,
  ): Promise<AgendaListResponseDto> {
    // 1. Load meeting & check read permission
    const meeting = await this.checkAgendaReadPermission(meetingId, userId);

    // 2. Compute meeting duration
    const meetingDurationMinutes = this.getMeetingDurationMinutes(meeting);

    // 3. Query agenda items with owner name
    const agendas = await this.dataSource
      .getRepository(MeetingAgendaEntity)
      .find({
        where: { meetingId: meeting.id },
        order: { agendaOrder: 'ASC' },
        relations: { owner: true },
      });

    // 3b. Batch-load attachments for all agenda items (1 query, tránh N+1)
    const attachmentsByAgendaId = await this.loadAgendaAttachmentsMap(
      agendas.map((a) => a.id),
    );

    // 4. Map to response DTOs
    const items = agendas.map(
      (agenda) =>
        new AgendaItemResponseDto({
          id: agenda.id,
          agendaOrder: agenda.agendaOrder,
          title: agenda.title,
          description: agenda.description,
          ownerId: agenda.ownerId,
          ownerName: agenda.owner?.fullName ?? null,
          plannedDurationMinutes: agenda.plannedDurationMinutes ?? 0,
          status: agenda.status,
          attachments: attachmentsByAgendaId.get(agenda.id) ?? [],
        }),
    );

    // 5. Calculate totals
    const totalPlannedDurationMinutes = items.reduce(
      (sum, item) => sum + item.plannedDurationMinutes,
      0,
    );
    const remainingDurationMinutes = Math.max(
      0,
      meetingDurationMinutes - totalPlannedDurationMinutes,
    );
    const durationStatus =
      totalPlannedDurationMinutes <= meetingDurationMinutes
        ? 'valid'
        : 'overflow';
    const isLockedForEditing =
      meeting.status !== MeetingStatus.PENDING_APPROVAL &&
      meeting.status !== MeetingStatus.SCHEDULED;
    const lockReason = isLockedForEditing ? 'MEETING_NOT_SCHEDULED' : null;

    return new AgendaListResponseDto({
      meetingId: meeting.id,
      meetingStatus: meeting.status,
      meetingDurationMinutes,
      totalPlannedDurationMinutes,
      remainingDurationMinutes,
      durationStatus,
      isLockedForEditing,
      lockReason,
      items,
    });
  }

  // ── T006: Validation Chain ─────────────────────────────────

  /**
   * Validate replace agenda request with priority chain.
   * Stops at first validation error.
   */
  private async validateReplaceAgendaRequest(
    meeting: MeetingEntity,
    dto: ReplaceAgendaDto,
  ): Promise<void> {
    // 1. Meeting time invalid
    this.validateMeetingTimeForAgenda(meeting);

    // 2. Meeting status blocked
    this.validateMeetingStatusForAgendaWrite(meeting);

    // 3. Item limit exceeded
    if (dto.items.length > 50) {
      throw new UnprocessableEntityException('AGENDA_ITEM_LIMIT_EXCEEDED');
    }

    // 4. Duplicate item id
    const requestIds = dto.items
      .filter((item) => item.id)
      .map((item) => item.id!);
    const uniqueIds = new Set(requestIds);
    if (uniqueIds.size !== requestIds.length) {
      throw new UnprocessableEntityException('AGENDA_DUPLICATE_ITEM_ID');
    }

    // 5. Item id not in meeting
    if (requestIds.length > 0) {
      const existingItems = await this.dataSource
        .getRepository(MeetingAgendaEntity)
        .find({
          where: { id: In(requestIds), meetingId: meeting.id },
        });
      const existingIdSet = new Set(existingItems.map((i) => i.id));
      const notFoundIds = requestIds.filter((id) => !existingIdSet.has(id));
      if (notFoundIds.length > 0) {
        throw new UnprocessableEntityException('AGENDA_ITEM_NOT_IN_MEETING');
      }
    }

    // 6. Field validation (per item)
    const participantUserIds = await this.getParticipantUserIds(meeting.id);

    for (const item of dto.items) {
      // Title empty after trim
      if (!item.title || item.title.trim().length === 0) {
        throw new UnprocessableEntityException('AGENDA_TITLE_REQUIRED');
      }
      // Title > 255
      if (item.title.trim().length > 255) {
        throw new UnprocessableEntityException('AGENDA_TITLE_TOO_LONG');
      }
      // Description > 2000
      if (item.description && item.description.length > 2000) {
        throw new UnprocessableEntityException('AGENDA_DESCRIPTION_TOO_LONG');
      }
      // plannedDurationMinutes invalid
      if (
        item.plannedDurationMinutes == null ||
        !Number.isInteger(item.plannedDurationMinutes) ||
        item.plannedDurationMinutes <= 0
      ) {
        throw new UnprocessableEntityException('AGENDA_INVALID_DURATION');
      }
    }

    // 7. Owner not participant
    for (const item of dto.items) {
      if (item.ownerId && !participantUserIds.has(item.ownerId)) {
        throw new UnprocessableEntityException('AGENDA_OWNER_NOT_PARTICIPANT');
      }
    }

    // 8. Duration overflow
    const meetingDurationMinutes = this.getMeetingDurationMinutes(meeting);
    const totalPlanned = dto.items.reduce(
      (sum, item) => sum + (item.plannedDurationMinutes ?? 0),
      0,
    );
    if (totalPlanned > meetingDurationMinutes) {
      throw new UnprocessableEntityException('AGENDA_DURATION_OVERFLOW');
    }
  }

  /**
   * Get set of internal participant user IDs for a meeting.
   */
  private async getParticipantUserIds(meetingId: string): Promise<Set<string>> {
    const participants = await this.dataSource
      .getRepository(MeetingParticipantEntity)
      .find({
        where: { meetingId },
        select: { userId: true },
      });
    return new Set(participants.map((p) => p.userId));
  }

  /**
   * Compare two agenda item arrays for no-op detection.
   * Compares: id, agendaOrder, title (trimmed), description, ownerId,
   * plannedDurationMinutes, status.
   */
  private isAgendaPayloadSame(
    existingItems: MeetingAgendaEntity[],
    requestItems: AgendaItemDto[],
  ): boolean {
    if (existingItems.length !== requestItems.length) return false;

    // Sort existing by agendaOrder
    const sortedExisting = [...existingItems].sort(
      (a, b) => a.agendaOrder - b.agendaOrder,
    );
    // Normalize request order by array index
    const normalizedRequest = requestItems.map((item, index) => ({
      id: item.id ?? null,
      agendaOrder: index + 1,
      title: item.title.trim(),
      description: item.description ?? null,
      ownerId: item.ownerId ?? null,
      plannedDurationMinutes: item.plannedDurationMinutes,
      status: 'planned' as const,
    }));

    for (let i = 0; i < sortedExisting.length; i++) {
      const e = sortedExisting[i];
      const r = normalizedRequest[i];
      if (
        e.id !== (r.id ?? undefined) ||
        e.agendaOrder !== r.agendaOrder ||
        e.title.trim() !== r.title ||
        (e.description ?? null) !== r.description ||
        (e.ownerId ?? null) !== r.ownerId ||
        e.plannedDurationMinutes !== r.plannedDurationMinutes ||
        e.status !== r.status
      ) {
        return false;
      }
    }
    return true;
  }

  // ── T007: Replace Agendas (Atomic Replace) ─────────────────

  /**
   * Atomic replace of entire agenda list.
   * Normalizes agenda_order, populates created_by/updated_by,
   * writes audit log.
   */
  async replaceAgendas(
    meetingId: string,
    dto: ReplaceAgendaDto,
    userId: string,
    clientContext?: ClientContext,
  ): Promise<ReplaceAgendaResponseDto> {
    // Load meeting
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });
    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException('MEETING_NOT_FOUND');
    }

    // Check write permission
    this.checkAgendaWritePermission(meeting, userId);

    // Validate request with priority chain
    await this.validateReplaceAgendaRequest(meeting, dto);

    // Load existing items for no-op detection
    const existingItems = await this.dataSource
      .getRepository(MeetingAgendaEntity)
      .find({
        where: { meetingId: meeting.id },
        order: { agendaOrder: 'ASC' },
      });

    // No-op detection
    if (this.isAgendaPayloadSame(existingItems, dto.items)) {
      const meetingDurationMinutes = this.getMeetingDurationMinutes(meeting);
      const totalPlanned = existingItems.reduce(
        (sum, item) => sum + (item.plannedDurationMinutes ?? 0),
        0,
      );
      const items = existingItems.map(
        (agenda) =>
          new AgendaItemResponseDto({
            id: agenda.id,
            agendaOrder: agenda.agendaOrder,
            title: agenda.title,
            description: agenda.description,
            ownerId: agenda.ownerId,
            ownerName: null,
            plannedDurationMinutes: agenda.plannedDurationMinutes ?? 0,
            status: agenda.status,
          }),
      );
      return new ReplaceAgendaResponseDto({
        meetingId: meeting.id,
        totalPlannedDurationMinutes: totalPlanned,
        remainingDurationMinutes: Math.max(
          0,
          meetingDurationMinutes - totalPlanned,
        ),
        items,
      });
    }

    // Atomic replace transaction
    const result = await this.dataSource.transaction(async (em) => {
      // Lock meeting row to prevent race conditions
      await em.findOne(MeetingEntity, {
        where: { id: meeting.id },
        lock: { mode: 'pessimistic_write' },
      });

      // Determine item IDs to keep (only those with valid IDs)
      const keepIds = dto.items
        .filter((item) => item.id)
        .map((item) => item.id!)
        .filter((id) => existingItems.some((e) => e.id === id));

      // Delete items not in request
      if (existingItems.length > 0) {
        const idsToDelete = existingItems
          .filter((e) => !keepIds.includes(e.id))
          .map((e) => e.id);
        if (idsToDelete.length > 0) {
          await em.delete(MeetingAgendaEntity, idsToDelete);
        }
      }

      // Normalize and save items
      const normalizedItems = dto.items.map((item, index) => ({
        agendaOrder: index + 1,
        title: item.title.trim(),
        description: item.description ?? null,
        ownerId: item.ownerId ?? null,
        plannedDurationMinutes: item.plannedDurationMinutes,
        status: AgendaStatus.PLANNED,
      }));

      // Update existing items
      const updatedItemIds: string[] = [];
      for (let i = 0; i < dto.items.length; i++) {
        const item = dto.items[i];
        if (item.id && existingItems.some((e) => e.id === item.id)) {
          await em.update(
            MeetingAgendaEntity,
            { id: item.id, meetingId: meeting.id },
            {
              agendaOrder: i + 1,
              title: item.title.trim(),
              description: item.description ?? null,
              ownerId: item.ownerId ?? null,
              plannedDurationMinutes: item.plannedDurationMinutes,
              updatedBy: userId,
            },
          );
          updatedItemIds.push(item.id);
        }
      }

      // Insert new items
      const newItems: MeetingAgendaEntity[] = [];
      for (let i = 0; i < dto.items.length; i++) {
        const item = dto.items[i];
        if (!item.id) {
          const newEntity = em.create(MeetingAgendaEntity, {
            meetingId: meeting.id,
            agendaOrder: i + 1,
            title: item.title.trim(),
            description: item.description ?? null,
            ownerId: item.ownerId ?? null,
            plannedDurationMinutes: item.plannedDurationMinutes,
            status: AgendaStatus.PLANNED,
            createdBy: userId,
            updatedBy: userId,
          });
          await em.save(MeetingAgendaEntity, newEntity);
          newItems.push(newEntity);
        }
      }

      // Reload all items to return sorted result
      const allItems = await em.find(MeetingAgendaEntity, {
        where: { meetingId: meeting.id },
        order: { agendaOrder: 'ASC' },
        relations: { owner: true },
      });

      // Write audit log
      const oldValueJson = existingItems.map((e) => ({
        id: e.id,
        agendaOrder: e.agendaOrder,
        title: e.title,
        description: e.description,
        ownerId: e.ownerId,
        plannedDurationMinutes: e.plannedDurationMinutes,
        status: e.status,
      }));
      const newValueJson = allItems.map((e) => ({
        id: e.id,
        agendaOrder: e.agendaOrder,
        title: e.title,
        description: e.description,
        ownerId: e.ownerId,
        plannedDurationMinutes: e.plannedDurationMinutes,
        status: e.status,
      }));

      const auditLog = em.create(AuditLogEntity, {
        userId,
        actionType: 'agenda_saved',
        entityType: 'meeting',
        entityId: meeting.id,
        oldValueJson: { items: oldValueJson },
        newValueJson: { items: newValueJson },
        ipAddress: clientContext?.ipAddress ?? null,
        userAgent: clientContext?.userAgent ?? null,
        severity: AuditLogSeverity.INFO,
      });
      await em.save(AuditLogEntity, auditLog);

      // Return response
      const meetingDurationMinutes = this.getMeetingDurationMinutes(meeting);
      const totalPlanned = allItems.reduce(
        (sum, item) => sum + (item.plannedDurationMinutes ?? 0),
        0,
      );
      const items = allItems.map(
        (agenda) =>
          new AgendaItemResponseDto({
            id: agenda.id,
            agendaOrder: agenda.agendaOrder,
            title: agenda.title,
            description: agenda.description,
            ownerId: agenda.ownerId,
            ownerName: agenda.owner?.fullName ?? null,
            plannedDurationMinutes: agenda.plannedDurationMinutes ?? 0,
            status: agenda.status,
          }),
      );
      return new ReplaceAgendaResponseDto({
        meetingId: meeting.id,
        totalPlannedDurationMinutes: totalPlanned,
        remainingDurationMinutes: Math.max(
          0,
          meetingDurationMinutes - totalPlanned,
        ),
        items,
      });
    });

    return result;
  }

  // ────────────────────────────────────────────────────────────
  // Agenda item feature (UC-MM-10 — PATCH single item)
  // ────────────────────────────────────────────────────────────

  /**
   * Check if PATCH payload has no field provided at all.
   */
  private isAgendaUpdatePayloadEmpty(dto: UpdateAgendaItemDto): boolean {
    return (
      dto.title === undefined &&
      dto.description === undefined &&
      dto.ownerId === undefined &&
      dto.plannedDurationMinutes === undefined &&
      dto.agendaOrder === undefined
    );
  }

  /**
   * Compute the agenda_order shift plan when moving one item to a new
   * position within the same meeting's agenda list.
   * Returns a map of agendaId -> newOrder for every item whose order changes
   * (including the moved item itself).
   */
  private computeAgendaOrderShift(
    items: MeetingAgendaEntity[],
    itemId: string,
    newOrder: number,
  ): Map<string, number> {
    if (
      !Number.isInteger(newOrder) ||
      newOrder < 1 ||
      newOrder > items.length
    ) {
      throw new UnprocessableEntityException('AGENDA_INVALID_ORDER');
    }

    const sorted = [...items].sort((a, b) => a.agendaOrder - b.agendaOrder);
    const currentIndex = sorted.findIndex((i) => i.id === itemId);
    if (currentIndex === -1) {
      throw new NotFoundException('AGENDA_ITEM_NOT_FOUND');
    }

    const reordered = [...sorted];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(newOrder - 1, 0, moved);

    const shiftMap = new Map<string, number>();
    reordered.forEach((agendaItem, index) => {
      const newOrderValue = index + 1;
      if (agendaItem.agendaOrder !== newOrderValue) {
        shiftMap.set(agendaItem.id, newOrderValue);
      }
    });
    return shiftMap;
  }

  /**
   * Build the response payload for a single agenda item, including
   * meeting-level duration totals.
   */
  private async buildAgendaItemUpdateResponse(
    em: EntityManager,
    meeting: MeetingEntity,
    item: MeetingAgendaEntity,
  ): Promise<AgendaItemUpdateResponseDto> {
    const allItems = await em.find(MeetingAgendaEntity, {
      where: { meetingId: meeting.id },
    });
    const meetingDurationMinutes = this.getMeetingDurationMinutes(meeting);
    const totalPlannedDurationMinutes = allItems.reduce(
      (sum, i) => sum + (i.plannedDurationMinutes ?? 0),
      0,
    );

    let ownerName: string | null = null;
    if (item.ownerId) {
      if (item.owner) {
        ownerName = item.owner.fullName ?? null;
      } else {
        const owner = await em.findOne(UserEntity, {
          where: { id: item.ownerId },
        });
        ownerName = owner?.fullName ?? null;
      }
    }

    return new AgendaItemUpdateResponseDto({
      id: item.id,
      meetingId: meeting.id,
      agendaOrder: item.agendaOrder,
      title: item.title,
      description: item.description,
      ownerId: item.ownerId,
      ownerName,
      plannedDurationMinutes: item.plannedDurationMinutes ?? 0,
      status: item.status,
      updatedAt: item.updatedAt,
      totalPlannedDurationMinutes,
      remainingDurationMinutes: Math.max(
        0,
        meetingDurationMinutes - totalPlannedDurationMinutes,
      ),
    });
  }

  /**
   * Partial update of a single agenda item (UC-MM-10).
   * Coexists with replaceAgendas() (UC-MM-09, atomic bulk replace) — both
   * share the same pessimistic_write lock on the meeting row to avoid
   * lost updates between the two write paths.
   */
  async updateAgendaItem(
    meetingId: string,
    agendaId: string,
    dto: UpdateAgendaItemDto,
    userId: string,
    clientContext?: ClientContext,
  ): Promise<AgendaItemUpdateResponseDto> {
    if (this.isAgendaUpdatePayloadEmpty(dto)) {
      throw new BadRequestException('AGENDA_UPDATE_PAYLOAD_EMPTY');
    }

    return this.dataSource.transaction(async (em) => {
      // Lock meeting row (shared lock resource with PUT /agendas)
      const meeting = await em.findOne(MeetingEntity, {
        where: { id: meetingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!meeting || meeting.deletedAt) {
        throw new NotFoundException('MEETING_NOT_FOUND');
      }

      // Load target agenda item
      const item = await em.findOne(MeetingAgendaEntity, {
        where: { id: agendaId, meetingId: meeting.id },
      });
      if (!item) {
        throw new NotFoundException('AGENDA_ITEM_NOT_FOUND');
      }

      // Permission & state checks
      this.checkAgendaWritePermission(meeting, userId);
      this.validateMeetingTimeForAgenda(meeting);
      this.validateMeetingStatusForAgendaWrite(meeting);

      // Field-level validation (only for fields present in request)
      let normalizedTitle: string | undefined;
      if (dto.title !== undefined) {
        normalizedTitle = dto.title.trim();
        if (normalizedTitle.length === 0) {
          throw new UnprocessableEntityException('AGENDA_TITLE_REQUIRED');
        }
        if (normalizedTitle.length > 255) {
          throw new UnprocessableEntityException('AGENDA_TITLE_TOO_LONG');
        }
      }
      if (
        dto.description !== undefined &&
        dto.description !== null &&
        dto.description.length > 2000
      ) {
        throw new UnprocessableEntityException('AGENDA_DESCRIPTION_TOO_LONG');
      }
      if (
        dto.plannedDurationMinutes !== undefined &&
        (!Number.isInteger(dto.plannedDurationMinutes) ||
          dto.plannedDurationMinutes <= 0)
      ) {
        throw new UnprocessableEntityException('AGENDA_INVALID_DURATION');
      }

      // Load all items of the meeting (needed for order shift + duration total)
      const allItems = await em.find(MeetingAgendaEntity, {
        where: { meetingId: meeting.id },
        order: { agendaOrder: 'ASC' },
      });

      // agendaOrder validation + shift plan (only if order actually changes)
      let orderShiftMap: Map<string, number> | null = null;
      if (
        dto.agendaOrder !== undefined &&
        dto.agendaOrder !== item.agendaOrder
      ) {
        orderShiftMap = this.computeAgendaOrderShift(
          allItems,
          item.id,
          dto.agendaOrder,
        );
      }

      // ownerId validation
      if (dto.ownerId !== undefined && dto.ownerId !== null) {
        const participantIds = await this.getParticipantUserIds(meeting.id);
        if (!participantIds.has(dto.ownerId)) {
          throw new UnprocessableEntityException(
            'AGENDA_OWNER_NOT_PARTICIPANT',
          );
        }
      }

      // No-op detection
      const isNoOp =
        (dto.title === undefined || normalizedTitle === item.title) &&
        (dto.description === undefined ||
          (dto.description ?? null) === (item.description ?? null)) &&
        (dto.ownerId === undefined ||
          (dto.ownerId ?? null) === (item.ownerId ?? null)) &&
        (dto.plannedDurationMinutes === undefined ||
          dto.plannedDurationMinutes === item.plannedDurationMinutes) &&
        !orderShiftMap;

      if (isNoOp) {
        return this.buildAgendaItemUpdateResponse(em, meeting, item);
      }

      // Duration overflow check (recompute total with the new value applied)
      const meetingDurationMinutes = this.getMeetingDurationMinutes(meeting);
      const newPlannedDuration =
        dto.plannedDurationMinutes !== undefined
          ? dto.plannedDurationMinutes
          : (item.plannedDurationMinutes ?? 0);
      const totalOthers = allItems
        .filter((i) => i.id !== item.id)
        .reduce((sum, i) => sum + (i.plannedDurationMinutes ?? 0), 0);
      if (totalOthers + newPlannedDuration > meetingDurationMinutes) {
        throw new UnprocessableEntityException('AGENDA_DURATION_OVERFLOW');
      }

      // Build diff for audit log + update payload
      const oldValueJson: Record<string, unknown> = {};
      const newValueJson: Record<string, unknown> = {};
      const updateFields: {
        updatedBy: string;
        title?: string;
        description?: string | null;
        ownerId?: string | null;
        plannedDurationMinutes?: number;
        agendaOrder?: number;
      } = { updatedBy: userId };

      if (dto.title !== undefined && normalizedTitle !== item.title) {
        oldValueJson.title = item.title;
        newValueJson.title = normalizedTitle;
        updateFields.title = normalizedTitle;
      }
      if (
        dto.description !== undefined &&
        (dto.description ?? null) !== (item.description ?? null)
      ) {
        oldValueJson.description = item.description;
        newValueJson.description = dto.description ?? null;
        updateFields.description = dto.description ?? null;
      }
      if (
        dto.ownerId !== undefined &&
        (dto.ownerId ?? null) !== (item.ownerId ?? null)
      ) {
        oldValueJson.ownerId = item.ownerId;
        newValueJson.ownerId = dto.ownerId ?? null;
        updateFields.ownerId = dto.ownerId ?? null;
      }
      if (
        dto.plannedDurationMinutes !== undefined &&
        dto.plannedDurationMinutes !== item.plannedDurationMinutes
      ) {
        oldValueJson.plannedDurationMinutes = item.plannedDurationMinutes;
        newValueJson.plannedDurationMinutes = dto.plannedDurationMinutes;
        updateFields.plannedDurationMinutes = dto.plannedDurationMinutes;
      }

      const reorderedAgendaIds: string[] = [];
      if (orderShiftMap) {
        oldValueJson.agendaOrder = item.agendaOrder;
        const newOwnOrder = orderShiftMap.get(item.id) ?? item.agendaOrder;
        newValueJson.agendaOrder = newOwnOrder;
        updateFields.agendaOrder = newOwnOrder;

        for (const [otherId, newOrder] of orderShiftMap) {
          if (otherId === item.id) continue;
          await em.update(
            MeetingAgendaEntity,
            { id: otherId },
            { agendaOrder: newOrder },
          );
          reorderedAgendaIds.push(otherId);
        }
      }

      await em.update(MeetingAgendaEntity, { id: item.id }, updateFields);

      // Audit log
      const auditLog = em.create(AuditLogEntity, {
        userId,
        actionType: 'agenda_item_updated',
        entityType: 'meeting_agenda',
        entityId: item.id,
        oldValueJson,
        newValueJson:
          reorderedAgendaIds.length > 0
            ? { ...newValueJson, reorderedAgendaIds }
            : newValueJson,
        ipAddress: clientContext?.ipAddress ?? null,
        userAgent: clientContext?.userAgent ?? null,
        severity: AuditLogSeverity.INFO,
      });
      await em.save(AuditLogEntity, auditLog);

      // Reload item with owner relation for response
      const updatedItem = await em.findOne(MeetingAgendaEntity, {
        where: { id: item.id },
        relations: { owner: true },
      });

      return this.buildAgendaItemUpdateResponse(em, meeting, updatedItem!);
    });
  }

  // ────────────────────────────────────────────────────────────
  // Agenda item feature (UC-MM-11 — DELETE single item)
  // ────────────────────────────────────────────────────────────

  /**
   * Shift agenda_order of every item after the deleted position down by 1,
   * keeping the remaining items sequential (1..N, no gaps).
   * Returns the ids of the items that were shifted.
   */
  private async renormalizeAfterDelete(
    em: EntityManager,
    meetingId: string,
    deletedOrder: number,
  ): Promise<string[]> {
    const affectedItems = await em.find(MeetingAgendaEntity, {
      where: { meetingId, agendaOrder: MoreThan(deletedOrder) },
    });
    for (const affected of affectedItems) {
      await em.update(
        MeetingAgendaEntity,
        { id: affected.id },
        { agendaOrder: affected.agendaOrder - 1 },
      );
    }
    return affectedItems.map((i) => i.id);
  }

  /**
   * Hard delete a single agenda item (UC-MM-11).
   * Coexists with replaceAgendas() (UC-MM-09) and updateAgendaItem()
   * (UC-MM-10) — all three share the same pessimistic_write lock on the
   * meeting row to avoid lost updates between write paths.
   */
  async deleteAgendaItem(
    meetingId: string,
    agendaId: string,
    userId: string,
    clientContext?: ClientContext,
  ): Promise<DeleteAgendaItemResponseDto> {
    return this.dataSource.transaction(async (em) => {
      // Lock meeting row (shared lock resource with PUT/PATCH /agendas)
      const meeting = await em.findOne(MeetingEntity, {
        where: { id: meetingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!meeting || meeting.deletedAt) {
        throw new NotFoundException('MEETING_NOT_FOUND');
      }

      // Load target agenda item
      const item = await em.findOne(MeetingAgendaEntity, {
        where: { id: agendaId, meetingId: meeting.id },
      });
      if (!item) {
        throw new NotFoundException('AGENDA_ITEM_NOT_FOUND');
      }

      // Permission & state checks
      this.checkAgendaWritePermission(meeting, userId);
      this.validateMeetingStatusForAgendaWrite(meeting);

      // Snapshot the item before deletion (for audit old_value_json)
      const oldValueJson: Record<string, unknown> = {
        id: item.id,
        agendaOrder: item.agendaOrder,
        title: item.title,
        description: item.description,
        ownerId: item.ownerId,
        plannedDurationMinutes: item.plannedDurationMinutes,
        status: item.status,
      };

      await em.delete(MeetingAgendaEntity, { id: item.id });

      const reorderedAgendaIds = await this.renormalizeAfterDelete(
        em,
        meeting.id,
        item.agendaOrder,
      );

      // Audit log
      const auditLog = em.create(AuditLogEntity, {
        userId,
        actionType: 'agenda_item_deleted',
        entityType: 'meeting_agenda',
        entityId: item.id,
        oldValueJson:
          reorderedAgendaIds.length > 0
            ? { ...oldValueJson, reorderedAgendaIds }
            : oldValueJson,
        newValueJson: null,
        ipAddress: clientContext?.ipAddress ?? null,
        userAgent: clientContext?.userAgent ?? null,
        severity: AuditLogSeverity.INFO,
      });
      await em.save(AuditLogEntity, auditLog);

      // Compute remaining totals for the response
      const remainingItems = await em.find(MeetingAgendaEntity, {
        where: { meetingId: meeting.id },
      });
      const meetingDurationMinutes = this.getMeetingDurationMinutes(meeting);
      const totalPlannedDurationMinutes = remainingItems.reduce(
        (sum, i) => sum + (i.plannedDurationMinutes ?? 0),
        0,
      );

      return new DeleteAgendaItemResponseDto({
        deleted: true,
        agendaId: item.id,
        meetingId: meeting.id,
        totalPlannedDurationMinutes,
        remainingDurationMinutes: Math.max(
          0,
          meetingDurationMinutes - totalPlannedDurationMinutes,
        ),
        remainingItemCount: remainingItems.length,
      });
    });
  }

  // ────────────────────────────────────────────────────────────
  // Agenda Attachment feature (đính kèm tài liệu cho agenda item)
  // Xem spec/features/meeting/feat-attach-meeting-agenda-document/
  // ────────────────────────────────────────────────────────────

  private getAgendaAttachmentFileExtension(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
  }

  /**
   * Multer/Busboy giải mã header filename của multipart/form-data theo latin1
   * mặc định (không tự đoán charset), trong khi trình duyệt hiện đại luôn gửi
   * byte UTF-8 thật cho tên file có dấu → ra mojibake nếu không sửa (vd
   * "SRS-tiếng-Việt-3.docx" thành "SRS-tiáº¿ng-Viá»t-3.docx", bug phát hiện
   * 2026-08-05 khi retest agenda attachment với file tên tiếng Việt thật).
   * Heuristic: re-decode byte của chuỗi (đang bị hiểu là latin1) sang UTF-8;
   * nếu ra ký tự thay thế U+FFFD tức chuỗi gốc vốn không phải UTF-8 bị đọc
   * nhầm (đã là ASCII/latin1 thật) → giữ nguyên, tránh làm hỏng ngược lại.
   */
  private normalizeUploadedFileName(name: string): string {
    try {
      const reDecoded = Buffer.from(name, 'latin1').toString('utf8');
      if (reDecoded !== name && !reDecoded.includes('�')) {
        return reDecoded;
      }
    } catch {
      // giữ nguyên tên gốc nếu không decode được
    }
    return name;
  }

  /**
   * Gộp 1 query duy nhất để lấy attachments cho nhiều agenda item cùng lúc
   * (tránh N+1 khi getAgendas() trả danh sách nhiều item). Xem FR-007.
   */
  private async loadAgendaAttachmentsMap(
    agendaIds: string[],
  ): Promise<Map<string, AgendaAttachmentDto[]>> {
    const map = new Map<string, AgendaAttachmentDto[]>();
    if (agendaIds.length === 0) {
      return map;
    }

    const files = await this.dataSource.getRepository(MediaFileEntity).find({
      where: {
        relatedEntityType: 'meeting_agenda',
        relatedEntityId: In(agendaIds),
        deletedAt: IsNull(),
      },
      order: { uploadedAt: 'DESC' },
    });

    for (const file of files) {
      const agendaId = file.relatedEntityId as string;
      const list = map.get(agendaId) ?? [];
      list.push(
        new AgendaAttachmentDto({
          id: file.id,
          fileName: file.fileName,
          mimeType: file.mimeType,
          fileSizeBytes: file.fileSizeBytes,
          fileUrl: file.fileUrl,
          uploadedBy: file.uploadedBy,
          uploadedAt: file.uploadedAt,
        }),
      );
      map.set(agendaId, list);
    }

    return map;
  }

  /**
   * Load meeting + agenda item cho thao tác WRITE (upload/xóa attachment),
   * tái dùng nguyên checkAgendaWritePermission/validateMeetingStatusForAgendaWrite
   * của feat-create-meeting-agenda (UC-MM-09). Không lock — dùng cho bước
   * validate sớm trước khi chạm storage; transaction bên trong addAgendaAttachment/
   * removeAgendaAttachment sẽ re-validate có lock để tránh race condition.
   */
  private async loadAgendaForAttachmentWrite(
    meetingId: string,
    agendaId: string,
    userId: string,
  ): Promise<{ meeting: MeetingEntity; agenda: MeetingAgendaEntity }> {
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });
    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Cuoc hop khong ton tai hoac da bi xoa',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }

    this.checkAgendaWritePermission(meeting, userId);
    this.validateMeetingStatusForAgendaWrite(meeting);

    const agenda = await this.dataSource
      .getRepository(MeetingAgendaEntity)
      .findOne({ where: { id: agendaId, meetingId: meeting.id } });
    if (!agenda) {
      throw new NotFoundException({
        success: false,
        message: 'Muc agenda khong ton tai',
        error: { code: 'AGENDA_ITEM_NOT_FOUND', details: { agendaId } },
      });
    }

    return { meeting, agenda };
  }

  async addAgendaAttachment(
    meetingId: string,
    agendaId: string,
    file: UploadedAgendaAttachmentFile | undefined,
    userId: string,
  ): Promise<AgendaAttachmentUploadResponseDto> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        success: false,
        message: 'Vui long dinh kem file',
        error: { code: 'AGENDA_ATTACHMENT_FILE_REQUIRED', details: {} },
      });
    }
    file.originalname = this.normalizeUploadedFileName(file.originalname);

    const maxBytes = this.configService.get<number>(
      'AGENDA_ATTACHMENT_MAX_BYTES',
      AGENDA_ATTACHMENT_MAX_BYTES_DEFAULT,
    );
    if (file.size > maxBytes) {
      throw new BadRequestException({
        success: false,
        message: `File vuot qua gioi han ${maxBytes} bytes`,
        error: {
          code: 'AGENDA_ATTACHMENT_FILE_TOO_LARGE',
          details: { maxBytes },
        },
      });
    }

    const allowedMimeTypes: string[] =
      this.configService.get<string[]>(
        'AGENDA_ATTACHMENT_ALLOWED_MIME_TYPES',
        AGENDA_ATTACHMENT_ALLOWED_MIME_TYPES,
      ) ?? AGENDA_ATTACHMENT_ALLOWED_MIME_TYPES;
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException({
        success: false,
        message: 'Dinh dang file khong duoc ho tro',
        error: {
          code: 'AGENDA_ATTACHMENT_FILE_TYPE_INVALID',
          details: { allowedMimeTypes },
        },
      });
    }

    const ext = this.getAgendaAttachmentFileExtension(file.originalname);
    const allowedExtensions =
      AGENDA_ATTACHMENT_MIME_TO_EXTENSIONS[file.mimetype];
    if (!allowedExtensions || !allowedExtensions.includes(ext)) {
      throw new BadRequestException({
        success: false,
        message: 'Duoi file khong khop voi dinh dang khai bao',
        error: {
          code: 'AGENDA_ATTACHMENT_FILE_TYPE_INVALID',
          details: { expectedExtensions: allowedExtensions },
        },
      });
    }

    // Validate ownership/status/agenda-existence sớm để tránh chạm storage khi request rõ ràng sai.
    const { meeting } = await this.loadAgendaForAttachmentWrite(
      meetingId,
      agendaId,
      userId,
    );

    const mediaFileId = randomUUID();
    let storageResult: {
      storageKey: string;
      publicUrl: string;
      sizeBytes: number;
    };
    try {
      storageResult = await this.storageService.saveFile({
        buffer: file.buffer,
        originalName: file.originalname,
        folder: 'agenda-attachments',
        storageKey: `agenda-attachments/${mediaFileId}${ext}`,
      });
    } catch (error) {
      this.logger.error(
        `Storage save failed for agenda attachment ${agendaId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadGatewayException({
        success: false,
        message: 'Khong the luu file len kho luu tru',
        error: { code: 'AGENDA_ATTACHMENT_STORAGE_FAILED', details: {} },
      });
    }

    const now = new Date();
    const maxCount = this.configService.get<number>(
      'AGENDA_ATTACHMENT_MAX_COUNT',
      AGENDA_ATTACHMENT_MAX_COUNT_DEFAULT,
    );

    try {
      await this.dataSource.transaction(async (manager) => {
        // Re-validate có lock để tránh race condition (FR-020).
        const lockedMeeting = await manager
          .getRepository(MeetingEntity)
          .createQueryBuilder('meeting')
          .setLock('pessimistic_write')
          .where('meeting.id = :meetingId', { meetingId })
          .getOne();
        if (!lockedMeeting || lockedMeeting.deletedAt) {
          throw new NotFoundException({
            success: false,
            message: 'Cuoc hop khong ton tai hoac da bi xoa',
            error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
          });
        }
        this.checkAgendaWritePermission(lockedMeeting, userId);
        this.validateMeetingStatusForAgendaWrite(lockedMeeting);

        const agendaStillExists = await manager
          .getRepository(MeetingAgendaEntity)
          .findOne({ where: { id: agendaId, meetingId } });
        if (!agendaStillExists) {
          throw new NotFoundException({
            success: false,
            message: 'Muc agenda khong ton tai',
            error: { code: 'AGENDA_ITEM_NOT_FOUND', details: { agendaId } },
          });
        }

        const currentCount = await manager
          .getRepository(MediaFileEntity)
          .count({
            where: {
              relatedEntityType: 'meeting_agenda',
              relatedEntityId: agendaId,
              deletedAt: IsNull(),
            },
          });
        if (currentCount >= maxCount) {
          throw new ConflictException({
            success: false,
            message: 'Da dat so luong file dinh kem toi da cho muc agenda nay',
            error: {
              code: 'AGENDA_ATTACHMENT_LIMIT_EXCEEDED',
              details: { maxCount, currentCount },
            },
          });
        }

        await manager.getRepository(MediaFileEntity).insert({
          id: mediaFileId,
          meetingId,
          relatedEntityType: 'meeting_agenda',
          relatedEntityId: agendaId,
          uploadedBy: userId,
          fileName: file.originalname,
          fileType: MediaFileType.DOCUMENT,
          mimeType: file.mimetype,
          storageProvider: StorageProvider.LOCAL,
          storageKey: storageResult.storageKey,
          fileUrl: storageResult.publicUrl,
          fileSizeBytes: String(storageResult.sizeBytes),
          isActive: true,
          uploadedAt: now,
        });

        const auditLog = manager.create(AuditLogEntity, {
          userId,
          actionType: 'meeting_agenda_attachment_uploaded',
          entityType: 'meeting_agenda',
          entityId: agendaId,
          newValueJson: {
            mediaFileId,
            fileName: file.originalname,
            fileSizeBytes: storageResult.sizeBytes,
          },
          severity: AuditLogSeverity.INFO,
        });
        await manager.save(AuditLogEntity, auditLog);
      });
    } catch (error) {
      await this.storageService
        .deleteFile(storageResult.storageKey)
        .catch((cleanupError) => {
          this.logger.warn(
            `Failed to clean up orphan storage file: ${storageResult.storageKey}`,
            cleanupError instanceof Error ? cleanupError.stack : undefined,
          );
        });
      throw error;
    }

    return new AgendaAttachmentUploadResponseDto({
      id: mediaFileId,
      agendaId,
      meetingId: meeting.id,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSizeBytes: String(storageResult.sizeBytes),
      fileUrl: storageResult.publicUrl,
      uploadedBy: userId,
      uploadedAt: now,
    });
  }

  async removeAgendaAttachment(
    meetingId: string,
    agendaId: string,
    fileId: string,
    userId: string,
  ): Promise<DeleteAgendaAttachmentResponseDto> {
    const result = await this.dataSource.transaction(async (manager) => {
      const meeting = await manager
        .getRepository(MeetingEntity)
        .createQueryBuilder('meeting')
        .setLock('pessimistic_write')
        .where('meeting.id = :meetingId', { meetingId })
        .getOne();
      if (!meeting || meeting.deletedAt) {
        throw new NotFoundException({
          success: false,
          message: 'Cuoc hop khong ton tai hoac da bi xoa',
          error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
        });
      }
      this.checkAgendaWritePermission(meeting, userId);
      this.validateMeetingStatusForAgendaWrite(meeting);

      const agenda = await manager
        .getRepository(MeetingAgendaEntity)
        .findOne({ where: { id: agendaId, meetingId } });
      if (!agenda) {
        throw new NotFoundException({
          success: false,
          message: 'Muc agenda khong ton tai',
          error: { code: 'AGENDA_ITEM_NOT_FOUND', details: { agendaId } },
        });
      }

      const mediaFile = await manager.getRepository(MediaFileEntity).findOne({
        where: {
          id: fileId,
          relatedEntityType: 'meeting_agenda',
          relatedEntityId: agendaId,
          deletedAt: IsNull(),
        },
      });
      if (!mediaFile) {
        throw new NotFoundException({
          success: false,
          message: 'File dinh kem khong ton tai hoac da bi xoa',
          error: { code: 'AGENDA_ATTACHMENT_NOT_FOUND', details: { fileId } },
        });
      }

      const deletedAt = new Date();
      await manager
        .getRepository(MediaFileEntity)
        .update({ id: fileId }, { deletedAt });

      const auditLog = manager.create(AuditLogEntity, {
        userId,
        actionType: 'meeting_agenda_attachment_deleted',
        entityType: 'meeting_agenda',
        entityId: agendaId,
        oldValueJson: { fileId, storageKey: mediaFile.storageKey },
        severity: AuditLogSeverity.INFO,
      });
      await manager.save(AuditLogEntity, auditLog);

      return { fileId, agendaId, deletedAt, storageKey: mediaFile.storageKey };
    });

    await this.storageService.deleteFile(result.storageKey).catch((error) => {
      this.logger.warn(
        `Failed to delete physical file from storage: ${result.storageKey}`,
        error instanceof Error ? error.stack : undefined,
      );
    });

    return new DeleteAgendaAttachmentResponseDto({
      fileId: result.fileId,
      agendaId: result.agendaId,
      deletedAt: result.deletedAt,
    });
  }

  async findMeetingRequests(
    queryDto: MeetingRequestQueryDto,
    authUser: any,
  ): Promise<{
    items: MeetingRequestListItemDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const page = Math.max(1, queryDto.page ?? 1);
      const limit = Math.min(100, Math.max(1, queryDto.limit ?? 20));
      const skip = (page - 1) * limit;

      const qb = this.dataSource
        .getRepository(MeetingRequestEntity)
        .createQueryBuilder('mr')
        .leftJoin('mr.requestedByUser', 'requester')
        .leftJoin('mr.meeting', 'meeting')
        .leftJoin('mr.decisionByUser', 'decider')
        .leftJoin('mr.targetRoom', 'room')
        .select([
          'mr.id',
          'mr.requestCode',
          'mr.requestType',
          'mr.approvalStatus',
          'mr.requestedAt',
          'mr.requestedStartTime',
          'mr.requestedEndTime',
          'mr.conflictCheckStatus',
          'mr.conflictSummaryJson',
          'mr.decisionAt',
          'mr.rejectionReason',
          'requester.id',
          'requester.fullName',
          'requester.email',
          'meeting.id',
          'meeting.title',
          'meeting.roomId',
          'meeting.hostId',
          'meeting.startTime',
          'meeting.endTime',
          'room.id',
          'room.roomName',
          'decider.id',
          'decider.fullName',
          'decider.email',
        ]);

      // ApprovalStatus filter
      const approvalStatus = queryDto.approvalStatus;
      if (!approvalStatus || approvalStatus === 'pending') {
        qb.andWhere('mr.approvalStatus = :status', {
          status: ApprovalStatus.PENDING,
        });
      } else if (approvalStatus !== 'all') {
        qb.andWhere('mr.approvalStatus = :status', { status: approvalStatus });
      }

      // requestType filter
      if (queryDto.requestType) {
        qb.andWhere('mr.requestType = :type', { type: queryDto.requestType });
      }

      // targetRoomId filter
      if (queryDto.targetRoomId) {
        qb.andWhere('mr.targetRoomId = :roomId', {
          roomId: queryDto.targetRoomId,
        });
      }

      // requestedById filter
      if (queryDto.requestedById) {
        qb.andWhere('mr.requestedBy = :userId', {
          userId: queryDto.requestedById,
        });
      }

      // Date range filter
      if (queryDto.from && queryDto.to) {
        qb.andWhere('mr.requestedAt BETWEEN :from AND :to', {
          from: new Date(queryDto.from),
          to: new Date(queryDto.to),
        });
      }

      // q search (request_code ILIKE)
      if (queryDto.q) {
        qb.andWhere('mr.requestCode ILIKE :q', { q: `%${queryDto.q}%` });
      }

      // Data scope filter
      const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
        authUser.userId,
      );
      const isAdmin = roles.some(
        (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
      );
      if (!isAdmin) {
        qb.andWhere(
          `(requester.direct_manager_id = :userId
            OR requester.department_id IN (
              SELECT d.id FROM departments d WHERE d.manager_user_id = :userId
            ))`,
          { userId: authUser.userId },
        );
      }

      // Sort
      // BE-fix: DTO allowlist (meeting-request-query.dto.ts) van nhan sortBy dang
      // snake_case tu client theo dung API convention chung (CLAUDE.md 8.4). Nhung
      // TypeORM QueryBuilder.orderBy('alias.property') bat buoc dung ten property
      // camelCase cua entity, khong phai ten cot snake_case. MeetingRequestEntity
      // cung khong co property `createdAt` rieng - `requestedAt` la thoi diem tao
      // request nen duoc dung lam gia tri tuong duong.
      const sortFieldMap: Record<string, string> = {
        requested_at: 'requestedAt',
        created_at: 'requestedAt',
        approval_status: 'approvalStatus',
        request_type: 'requestType',
      };
      const sortField = sortFieldMap[queryDto.sortBy ?? ''] ?? 'requestedAt';
      const sortOrder = queryDto.sortOrder === 'asc' ? 'ASC' : 'DESC';
      qb.orderBy(`mr.${sortField}`, sortOrder);

      // Pagination
      qb.skip(skip).take(limit);

      const [items, total] = await qb.getManyAndCount();

      const listItems = items.map((mr) => {
        return new MeetingRequestListItemDto(
          mr.id,
          mr.requestCode,
          mr.requestType,
          mr.approvalStatus,
          mr.requestedAt,
          mr.requestedStartTime,
          mr.requestedEndTime,
          mr.conflictCheckStatus,
          mr.conflictSummaryJson ?? null,
          mr.decisionAt,
          mr.rejectionReason,
          new UserSummaryDto(
            mr.requestedByUser.id,
            mr.requestedByUser.fullName,
            mr.requestedByUser.email,
          ),
          mr.targetRoom
            ? new RoomSummaryDto(mr.targetRoom.id, mr.targetRoom.roomName)
            : null,
          mr.decisionByUser
            ? new UserSummaryDto(
                mr.decisionByUser.id,
                mr.decisionByUser.fullName,
                mr.decisionByUser.email,
              )
            : null,
          mr.meeting
            ? {
                id: mr.meeting.id,
                title: mr.meeting.title,
                roomId: mr.meeting.roomId,
                hostId: mr.meeting.hostId,
              }
            : null,
          // F-R3: snapshot giờ/phòng CŨ — chỉ dùng khi request là UPDATE_TIME/
          // UPDATE_ROOM (DTO tự lọc theo isEditRequest, xem constructor).
          mr.meeting
            ? {
                startTime: mr.meeting.startTime,
                endTime: mr.meeting.endTime,
                roomId: mr.meeting.roomId,
              }
            : null,
        );
      });

      return { items: listItems, total, page, limit };
    } catch (error) {
      this.logger.error(
        'Failed to retrieve meeting requests',
        (error as Error).stack,
      );
      throw error;
    }
  }
}
