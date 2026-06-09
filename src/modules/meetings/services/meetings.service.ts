import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, Not, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';

import {
  MeetingEntity,
  MeetingStatus,
  MeetingType,
  MeetingMode,
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
import type { AvailableRoomDto, CapacityWarning } from '../dto/available-room.dto.js';
import {
  BackgroundJobEntity,
  BackgroundJobType,
  BackgroundJobStatus,
} from '../../administration/entities/background-job.entity.js';

export interface AuthUser {
  userId: string;
  jti?: string;
  exp?: number;
}

export interface ClientContext {
  ipAddress?: string;
  userAgent?: string;
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
}

interface ConflictResult {
  hasConflict: boolean;
  conflictingBookingId: string | null;
}

interface ParticipantConflictResult {
  conflicts: Array<{
    userId: string;
    meetingTitle: string;
    meetingId: string;
    startTime: Date;
    endTime: Date;
  }>;
}

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(private readonly dataSource: DataSource) {}

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

  async generateMeetingCode(): Promise<string> {
    const today = new Date();
    const dateStr =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, '0') +
      String(today.getDate()).padStart(2, '0');

    const count = await this.dataSource.getRepository(MeetingEntity).count({
      where: {
        createdAt: MoreThanOrEqual(
          new Date(today.getFullYear(), today.getMonth(), today.getDate()),
        ),
      },
    });

    const seq = String(count + 1).padStart(3, '0');
    return `MT-${dateStr}-${seq}`;
  }

  async generateBookingCode(): Promise<string> {
    const today = new Date();
    const dateStr =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, '0') +
      String(today.getDate()).padStart(2, '0');

    const count = await this.dataSource.getRepository(RoomBookingEntity).count({
      where: {
        createdAt: MoreThanOrEqual(
          new Date(today.getFullYear(), today.getMonth(), today.getDate()),
        ),
      },
    });

    const seq = String(count + 1).padStart(3, '0');
    return `BK-${dateStr}-${seq}`;
  }

  async checkParticipantConflicts(
    userIds: string[],
    startTime: Date,
    endTime: Date,
  ): Promise<ParticipantConflictResult> {
    if (!userIds.length) {
      return { conflicts: [] };
    }

    const conflicts = await this.dataSource
      .getRepository(MeetingParticipantEntity)
      .createQueryBuilder('mp')
      .innerJoin('mp.meeting', 'm')
      .select(['mp.userId', 'm.title', 'm.id', 'm.startTime', 'm.endTime'])
      .where('mp.userId IN (:...userIds)', { userIds })
      .andWhere('m.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [MeetingStatus.CANCELLED, MeetingStatus.COMPLETED],
      })
      .andWhere('m.startTime < :endTime', { endTime })
      .andWhere('m.endTime > :startTime', { startTime })
      .getMany();

    return {
      conflicts: conflicts.map((mp) => {
        const meeting = (
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
          meetingTitle: meeting.title,
          meetingId: meeting.id,
          startTime: meeting.startTime,
          endTime: meeting.endTime,
        };
      }),
    };
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

    const meetingCode = await this.generateMeetingCode();
    const bookingCode = await this.generateBookingCode();

    const participantConflictResult = await this.checkParticipantConflicts(
      uniqueParticipantIds.filter((id) => id !== hostId),
      startTime,
      endTime,
    );

    const approverIds = await this.resolveApproverIds();

    let meeting: MeetingEntity;
    let request: MeetingRequestEntity;
    let booking: RoomBookingEntity;

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
          meetingMode: (dto.meetingMode as MeetingMode) || MeetingMode.OFFLINE,
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
          requestCode: meetingCode,
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

        if (approverIds.length > 0) {
          const notification = em.create(NotificationEntity, {
            notificationType: NotificationType.MEETING_REQUEST_CREATED,
            channel: NotificationChannel.IN_APP,
            subject: `Yêu cầu họp mới: ${dto.title}`,
            content: `Người dùng ${authUser.userId} đã tạo yêu cầu cuộc họp "${dto.title}" chờ phê duyệt.`,
            relatedEntityType: 'meeting_request',
            relatedEntityId: request.id,
            recipientScope: 'user_list',
            recipientUserIdsJson: approverIds,
            priority: NotificationPriority.NORMAL,
            deliveryStatus: NotificationDeliveryStatus.QUEUED,
            createdBy: authUser.userId,
          });
          await em.save(NotificationEntity, notification);
        }

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
    } catch (error: unknown) {
      this.logger.error(
        `Transaction failed for meeting creation: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
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

    if (meeting.status !== MeetingStatus.SCHEDULED) {
      throw new ConflictException({
        success: false,
        message:
          'Không thể thay đổi thời gian dự kiến cho cuộc họp đang diễn ra, đã kết thúc hoặc đã bị hủy.',
        error: { code: 'MEETING_STATUS_NOT_EDITABLE', details: { meetingId } },
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
        .select(['mp.userId', 'm.title', 'm.id', 'm.startTime', 'm.endTime'])
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

    try {
      await this.dataSource.transaction(async (em) => {
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
          const bookingCode = await this.generateBookingCode();
          const newBooking = em.create(RoomBookingEntity, {
            bookingCode,
            meetingId,
            roomId: targetRoomId,
            bookingType: BookingType.SCHEDULED,
            reservedStartTime: newStartTime,
            reservedEndTime: newEndTime,
            status: RoomBookingStatus.APPROVED,
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

        const request = em.create(MeetingRequestEntity, {
          requestType: MeetingRequestType.UPDATE_TIME,
          requestedBy: authUser.userId,
          meetingId,
          targetRoomId,
          requestedStartTime: newStartTime,
          requestedEndTime: newEndTime,
          approvalMode: ApprovalMode.AUTO,
          approvalStatus: ApprovalStatus.APPLIED,
          conflictCheckStatus: ConflictCheckStatus.CLEAR,
          conflictSummaryJson: {
            participantConflicts:
              participantConflicts.length > 0 ? participantConflicts : null,
          },
          requestPayloadJson: {
            startTime: dto.startTime,
            endTime: dto.endTime,
            newRoomId: dto.newRoomId || null,
            overrideParticipantConflict:
              dto.overrideParticipantConflict || false,
            changeReason: dto.changeReason || null,
          } as any,
          appliedAt: new Date(),
        });
        await em.save(MeetingRequestEntity, request);

        const event = em.create(MeetingEventEntity, {
          meetingId,
          eventType: MeetingEventType.MEETING_TIME_UPDATED,
          actorUserId: authUser.userId,
          sourceType: MeetingEventSourceType.MANUAL,
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
            requestId: 'req-' + Date.now(),
          } as any,
          ipAddress: clientContext.ipAddress || null,
          userAgent: clientContext.userAgent || null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);
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

      const notification = this.dataSource
        .getRepository(NotificationEntity)
        .create({
          notificationType: NotificationType.MEETING_TIME_UPDATED,
          channel: NotificationChannel.IN_APP,
          subject: `Cập nhật thời gian cuộc họp: ${meeting.title}`,
          content: `Thời gian cuộc họp "${meeting.title}" đã được cập nhật.`,
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          recipientScope: 'user_list',
          recipientUserIdsJson: allUserIds,
          recipientEmailsJson: [
            ...(externalParticipants
              .filter((ep) => ep.email)
              .map((ep) => ep.email) as string[]),
          ],
          priority: 'normal' as any,
          deliveryStatus: NotificationDeliveryStatus.QUEUED,
          payloadJson: {
            oldStartTime: oldMeetingData.startTime,
            oldEndTime: oldMeetingData.endTime,
            newStartTime: dto.startTime,
            newEndTime: dto.endTime,
            oldRoomId: meeting.roomId,
            newRoomId: targetRoomId,
            changeReason: dto.changeReason || null,
          },
          createdBy: authUser.userId,
        });
      await this.dataSource
        .getRepository(NotificationEntity)
        .save(notification);

      const emailRecipients = allUserIds.filter((id) => id !== authUser.userId);
      if (emailRecipients.length > 0 || externalParticipants.length > 0) {
        const bgJob = this.dataSource
          .getRepository(BackgroundJobEntity)
          .create({
            jobType: BackgroundJobType.SEND_EMAIL,
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            status: BackgroundJobStatus.QUEUED,
            inputJson: {
              notificationId: notification.id,
              template: 'meeting_time_updated',
            },
            requestedBy: authUser.userId,
          });
        await this.dataSource.getRepository(BackgroundJobEntity).save(bgJob);
      }
    } catch (notifError: unknown) {
      this.logger.error(
        `Failed to create notification for meeting time update: ${(notifError as Error).message}`,
      );
      notificationStatus = 'failed';
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
      updatedAt: new Date().toISOString(),
    };
  }

  // ── T007: Helpers ──────────────────────────────────────────────────

  private async getAttendeeCount(meetingId: string): Promise<number> {
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
      if (room.locationDescription) locationParts.push(room.locationDescription);

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

    if (meeting.status !== MeetingStatus.SCHEDULED) {
      throw new ConflictException({
        success: false,
        message: 'Chỉ có thể đổi phòng cho cuộc họp đang ở trạng thái Đã lên lịch.',
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
        error: { code: 'ROOM_NOT_AVAILABLE', details: { roomId: dto.newRoomId } },
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

    try {
      await this.dataSource.transaction(async (em) => {
        const lockedMeeting = await em.findOne(MeetingEntity, {
          where: { id: meetingId },
          lock: { mode: 'pessimistic_write' },
        });

        if (
          !lockedMeeting ||
          lockedMeeting.status !== MeetingStatus.SCHEDULED
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
          status: RoomBookingStatus.APPROVED,
          bookedBy: authUser.userId,
        });
        await em.save(RoomBookingEntity, newBooking);
        newBookingId = newBooking.id;

        await em.update(
          MeetingEntity,
          meetingId,
          {
            roomId: dto.newRoomId,
            updatedBy: authUser.userId,
          },
        );

        await em.save(MeetingEventEntity, {
          meetingId,
          eventType: MeetingEventType.ROOM_CHANGED,
          actorUserId: authUser.userId,
          sourceType: MeetingEventSourceType.MANUAL,
          description: `Đổi phòng từ "${oldRoomName}" sang "${newRoomName}"`,
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
          oldStatus: RoomBookingStatus.APPROVED,
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
          newStatus: RoomBookingStatus.APPROVED,
          description: `Phòng được đặt lại từ "${oldRoomName}"`,
        });

        await em.save(MeetingRequestEntity, {
          requestCode: bookingCode,
          meetingId,
          requestType: MeetingRequestType.UPDATE_ROOM,
          requestedBy: authUser.userId,
          targetRoomId: dto.newRoomId,
          requestedStartTime: meeting.startTime,
          requestedEndTime: meeting.endTime,
          approvalMode: ApprovalMode.AUTO,
          approvalStatus: ApprovalStatus.APPLIED,
          conflictCheckStatus: ConflictCheckStatus.CLEAR,
          requestPayloadJson: {
            changeReason: dto.changeReason || null,
            confirmCapacityOverride: dto.confirmCapacityOverride || false,
            oldRoomId: meeting.roomId,
          } as any,
          appliedAt: new Date(),
        });

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
          ipAddress: clientContext.ipAddress || null,
          userAgent: clientContext.userAgent || null,
          severity: AuditLogSeverity.INFO,
        });
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

      const notification = this.dataSource
        .getRepository(NotificationEntity)
        .create({
          notificationType: NotificationType.MEETING_ROOM_UPDATED,
          channel: NotificationChannel.IN_APP,
          subject: `Cập nhật phòng họp: ${meeting.title}`,
          content: `Phòng họp cho cuộc họp "${meeting.title}" đã được thay đổi từ "${oldRoomName}" sang "${newRoomName}".`,
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          recipientScope: 'user_list',
          recipientUserIdsJson: allUserIds,
          recipientEmailsJson: (externalParticipants || [])
            .filter((ep) => ep.email)
            .map((ep) => ep.email) as string[],
          priority: NotificationPriority.NORMAL,
          deliveryStatus: NotificationDeliveryStatus.QUEUED,
          payloadJson: {
            oldRoomId: meeting.roomId,
            oldRoomName,
            newRoomId: dto.newRoomId,
            newRoomName,
            changeReason: dto.changeReason || null,
          },
          createdBy: authUser.userId,
        });
      await this.dataSource.getRepository(NotificationEntity).save(notification);

      const emailRecipients = allUserIds.filter(
        (id) => id !== authUser.userId,
      );
      if (emailRecipients.length > 0 || (externalParticipants || []).length > 0) {
          const bgJob = this.dataSource
            .getRepository(BackgroundJobEntity)
            .create({
              jobType: BackgroundJobType.SEND_EMAIL,
              relatedEntityType: 'meeting',
              relatedEntityId: meetingId,
              status: BackgroundJobStatus.QUEUED,
              inputJson: {
                notificationId: notification.id,
                template: 'meeting_room_updated',
                maxRetries: 3,
              } as any,
              requestedBy: authUser.userId,
            });
        await this.dataSource.getRepository(BackgroundJobEntity).save(bgJob);
      }

      notificationStatus = 'sent';
    } catch (notifError: unknown) {
      this.logger.error(
        `Failed to create notification for meeting room update: ${(notifError as Error).message}`,
      );
      notificationStatus = 'failed';
    }

    return {
      meetingId,
      oldRoom: { id: meeting.roomId!, name: oldRoomName },
      newRoom: { id: dto.newRoomId, name: newRoomName },
      oldBookingId: oldBooking?.id || '',
      newBookingId,
      startTime: meeting.startTime.toISOString(),
      endTime: meeting.endTime.toISOString(),
      notificationStatus,
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
          ? 'Cuộc họp đã bắt đầu. Bạn không thể hủy mà chỉ có thể chọn \'Kết thúc sớm\'.'
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
          'Cuộc họp đã bắt đầu. Bạn không thể hủy mà chỉ có thể chọn \'Kết thúc sớm\'.',
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
              (cancellationReason
                ? ` Lý do: ${cancellationReason}`
                : ''),
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

    // ── Step 5: Outside transaction — create notification + background_job ──
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

      const allRecipientEmails = [
        ...(participants || [])
          .filter((p) => (p as unknown as Record<string, unknown>)?.email)
          .map(
            (p) =>
              (
                p as unknown as {
                  email?: string;
                }
              ).email,
          ),
        ...(externalParticipants || [])
          .filter((ep) => ep.email)
          .map((ep) => ep.email),
      ].filter(Boolean) as string[];

      const notificationReason = cancellationReason
        ? ` Lý do: ${cancellationReason}`
        : '';

      const notification = this.dataSource
        .getRepository(NotificationEntity)
        .create({
          notificationType: NotificationType.CANCELLATION,
          channel: NotificationChannel.EMAIL,
          subject: `[CANCELLED] ${meeting.title}`,
          content: `Cuộc họp "${meeting.title}" đã bị hủy.${notificationReason}`,
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          recipientScope: 'user_list',
          recipientUserIdsJson: allUserIds,
          recipientEmailsJson: allRecipientEmails,
          priority: NotificationPriority.NORMAL,
          deliveryStatus: NotificationDeliveryStatus.QUEUED,
          payloadJson: {
            action: 'cancel_meeting',
            meetingId,
            reason: cancellationReason ?? null,
          } as any,
          createdBy: authUser.userId,
        });
      await this.dataSource.getRepository(NotificationEntity).save(notification);

      if (allUserIds.length > 0 || allRecipientEmails.length > 0) {
        const bgJob = this.dataSource
          .getRepository(BackgroundJobEntity)
          .create({
            jobType: BackgroundJobType.SEND_EMAIL,
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            status: BackgroundJobStatus.QUEUED,
            inputJson: {
              notificationId: notification.id,
              template: 'meeting_cancelled',
            } as any,
            requestedBy: authUser.userId,
          });
        await this.dataSource.getRepository(BackgroundJobEntity).save(bgJob);
      }
    } catch (notifError: unknown) {
      this.logger.error(
        `Failed to queue cancellation notification: ${(notifError as Error).message}`,
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

  private async checkUserPermission(
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
        .andWhere(
          '(ur.expiredAt IS NULL OR ur.expiredAt > NOW())',
        )
        .getOne();

      return !!result;
    } catch {
      return false;
    }
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
}
