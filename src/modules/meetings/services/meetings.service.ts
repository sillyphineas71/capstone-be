import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { DataSource, In, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';

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
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
  BookingType,
} from '../../rooms/entities/room-booking.entity.js';
import {
  NotificationEntity,
  NotificationType,
  NotificationChannel,
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

export interface AuthUser {
  userId: string;
  jti?: string;
  exp?: number;
}

export interface ClientContext {
  ipAddress?: string;
  userAgent?: string;
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
            priority: 'normal' as any,
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
