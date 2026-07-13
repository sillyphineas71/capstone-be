import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../../meetings/entities/meeting-event.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
} from '../../rooms/entities/room-booking.entity.js';
import {
  RoomBookingUsageEntity,
  RoomUsageStatus,
  OccupancySource,
} from '../../rooms/entities/room-booking-usage.entity.js';
import { RoomEventEntity } from '../../rooms/entities/room-event.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import {
  AttendanceRecordEntity,
  AttendanceRecordStatus,
} from '../../attendance/entities/attendance-record.entity.js';
import {
  PresenceSnapshotEntity,
  PresenceStatus as SnapshotPresenceStatus,
} from '../../presence/entities/presence-snapshot.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import {
  MeetingRequestEntity,
  MeetingRequestType,
  ApprovalMode,
  ApprovalStatus,
  ConflictCheckStatus,
} from '../../meetings/entities/meeting-request.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
} from '../../meetings/entities/meeting-participant.entity.js';
import {
  NotificationEntity,
  NotificationChannel,
  NotificationType,
  NotificationPriority,
} from '../../notifications/entities/notification.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { MeetingNoteEntity } from '../../meetings/entities/meeting-note.entity.js';
import { TimelineQueryDto } from '../dto/timeline-query.dto.js';
import { TimelineItemDto } from '../dto/timeline-item.dto.js';
import { DepartmentEntity } from '../../accounts/entities/department.entity.js';
import { WebsocketService } from '../../websocket/websocket.service.js';

import { StartMeetingResponseDto } from '../dto/start-meeting-response.dto.js';
import { EndMeetingResponseDto } from '../dto/end-meeting-response.dto.js';
import { PresentAttendeesResponseDto } from '../dto/present-attendees-response.dto.js';
import {
  PresenceStatus,
  PresentAttendeeItem,
} from '../types/present-attendee.type.js';
import { DeviceStartMeetingParams } from '../types/device-start-meeting-params.type.js';
import { MEETING_START_ERRORS } from '../constants/meeting-start-error.constant.js';
import { PRESENT_ATTENDEES_ERRORS } from '../constants/present-attendees-error.constant.js';
import { MEETING_EXTENSION_ERRORS } from '../constants/meeting-extension-error.constant.js';
import { MEETING_END_ERRORS } from '../constants/meeting-end-error.constant.js';
import {
  ExtensionRequestDto,
  ExtensionRequestResponseDto,
  DecideExtensionDto,
  DecideExtensionResponseDto,
} from '../dto/index.js';
import {
  ExtensionPolicy,
  DEFAULT_EXTENSION_POLICY,
} from '../types/extension-policy.type.js';
import { AttendanceEventEntity } from '../../attendance/entities/attendance-event.entity.js';
import { MEETING_ATTENDANCE_ERRORS } from '../constants/meeting-attendance-error.constant.js';
import { AttendanceQueryDto } from '../dto/attendance-query.dto.js';
import {
  MeetingAttendanceResponseDto,
  AttendanceParticipantDto,
  AttendanceMetaDto,
} from '../dto/attendance-response.dto.js';
import {
  AttendanceStatus,
  ParticipantState,
} from '../types/attendance-participant.type.js';
import { QueueService } from '../../queue/queue.service.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { ConfigService } from '@nestjs/config';
import { ScheduleWarningResult } from '../types/schedule-warning-result.type.js';
import { MEETING_WARNING_ERRORS } from '../constants/meeting-warning-error.constant.js';
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

@Injectable()
export class LiveMeetingService {
  private readonly logger = new Logger(LiveMeetingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly websocketService: WebsocketService,
    private readonly queueService: QueueService,
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly configService: ConfigService,
  ) {
    this.schedulerQueueName = this.configService.get<string>(
      'QUEUE_SCHEDULER',
      'scheduler',
    );
  }

  private readonly schedulerQueueName: string;
  private readonly DEFAULT_WARNING_MINUTES = 10;
  private readonly SCHEDULER_JOB_NAME = 'meeting-time-warning';

  /**
   * ───────────────────────────────────────────────────────────
   *  Public API — Manual Start (Normal Flow)
   * ───────────────────────────────────────────────────────────
   */
  async startMeeting(
    meetingId: string,
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<StartMeetingResponseDto> {
    // ── Step 1: Load meeting ──
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy cuộc họp',
        error: {
          code: MEETING_START_ERRORS.MEETING_NOT_FOUND,
          details: { meetingId },
        },
      });
    }

    // ── Step 2: Authorization — Host or Organizer ──
    if (
      meeting.organizerId !== authUser.userId &&
      meeting.hostId !== authUser.userId
    ) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền bắt đầu phiên họp này',
        error: {
          code: 'FORBIDDEN',
          details: {
            required: 'must be host or organizer of the meeting',
          },
        },
      });
    }

    // ── Step 3: Pre-validation ──
    this.validateMeetingCanStart(meeting);

    // ── Step 4: Idempotent check ──
    if (meeting.actualStartTime) {
      this.logger.log(
        `[startMeeting] Idempotent: meeting ${meetingId} already started`,
      );
      return new StartMeetingResponseDto({
        meetingId: meeting.id,
        status: MeetingStatus.IN_PROGRESS,
        actualStartTime: meeting.actualStartTime.toISOString(),
        alreadyStarted: true,
      });
    }

    // ── Step 5: Execute transaction ──
    const actualStartTime = await this.executeStartMeetingInTransaction(
      meetingId,
      MeetingEventSourceType.MANUAL,
      authUser.userId,
      clientContext,
    );

    // ── Step 6: Post-transaction — WebSocket push (best-effort) ──
    this.emitMeetingStartedEvent(
      meetingId,
      actualStartTime,
      meeting.startTime,
      meeting.endTime,
      meeting.roomId ?? undefined,
      authUser.userId,
    );

    // ── Step 7: Schedule warning job (UC-IMM-12, best-effort) ──
    let warningScheduledAt: string | undefined;
    let warningSkipped: boolean | undefined;
    try {
      const warningResult = await this.scheduleWarningJob(meetingId);
      if (warningResult.skipped === false) {
        warningScheduledAt = warningResult.warningScheduledAt?.toISOString();
      } else {
        warningSkipped = true;
      }
    } catch (warnErr: unknown) {
      this.logger.error(
        '[startMeeting] scheduleWarningJob failed: ' +
          (warnErr as Error).message,
      );
      warningSkipped = true;
    }

    return new StartMeetingResponseDto({
      meetingId: meeting.id,
      status: MeetingStatus.IN_PROGRESS,
      actualStartTime: actualStartTime.toISOString(),
      alreadyStarted: false,
      warningScheduledAt,
      warningSkipped,
    });
  }

  /**
   * ───────────────────────────────────────────────────────────
   *  Internal API — Device Check-in Start (AF1)
   * ───────────────────────────────────────────────────────────
   */
  async startMeetingFromDeviceCheckIn(
    params: DeviceStartMeetingParams,
  ): Promise<StartMeetingResponseDto> {
    const now = new Date();
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

    // Tìm meeting scheduled phù hợp với host + room + time window
    const meetings = await this.dataSource.getRepository(MeetingEntity).find({
      where: {
        hostId: params.recognizedUserId,
        roomId: params.roomId,
        status: MeetingStatus.SCHEDULED,
      },
    });

    const matchedMeetings = meetings.filter((m) => {
      if (m.deletedAt) return false;
      if (m.actualStartTime) return false;
      if (now >= fifteenMinutesAgo && now < m.endTime) return true;
      return false;
    });

    if (matchedMeetings.length === 0) {
      throw new ConflictException({
        success: false,
        message: 'Không tìm thấy cuộc họp phù hợp để bắt đầu từ thiết bị',
        error: {
          code: MEETING_START_ERRORS.MEETING_START_AMBIGUOUS_DEVICE_MATCH,
          details: {
            recognizedUserId: params.recognizedUserId,
            roomId: params.roomId,
            matchedCount: 0,
          },
        },
      });
    }

    if (matchedMeetings.length > 1) {
      throw new ConflictException({
        success: false,
        message: 'Phát hiện nhiều cuộc họp phù hợp, không thể tự động bắt đầu',
        error: {
          code: MEETING_START_ERRORS.MEETING_START_AMBIGUOUS_DEVICE_MATCH,
          details: {
            recognizedUserId: params.recognizedUserId,
            roomId: params.roomId,
            matchedCount: matchedMeetings.length,
          },
        },
      });
    }

    const meeting = matchedMeetings[0];

    // Idempotent check
    if (meeting.actualStartTime) {
      return new StartMeetingResponseDto({
        meetingId: meeting.id,
        status: MeetingStatus.IN_PROGRESS,
        actualStartTime: meeting.actualStartTime.toISOString(),
        alreadyStarted: true,
      });
    }

    this.logger.log(
      `[DeviceStart] Starting meeting ${meeting.id} from device ${params.deviceId} check-in`,
    );

    // Execute — actorUserId là recognizedUserId (host), sourceType = DEVICE
    const actualStartTime = await this.executeStartMeetingInTransaction(
      meeting.id,
      MeetingEventSourceType.DEVICE,
      params.recognizedUserId,
      { ipAddress: undefined, userAgent: undefined },
    );

    // WebSocket push
    this.emitMeetingStartedEvent(
      meeting.id,
      actualStartTime,
      meeting.startTime,
      meeting.endTime,
      meeting.roomId ?? undefined,
      params.recognizedUserId,
    );

    return new StartMeetingResponseDto({
      meetingId: meeting.id,
      status: MeetingStatus.IN_PROGRESS,
      actualStartTime: actualStartTime.toISOString(),
      alreadyStarted: false,
    });
  }

  /**
   * ───────────────────────────────────────────────────────────
   *  Private: Pre-validation (không cần lock)
   * ───────────────────────────────────────────────────────────
   */
  private validateMeetingCanStart(meeting: MeetingEntity): void {
    const now = new Date();

    switch (meeting.status) {
      case MeetingStatus.COMPLETED:
        throw new ConflictException({
          success: false,
          message: 'Cuộc họp đã kết thúc',
          error: {
            code: MEETING_START_ERRORS.MEETING_ALREADY_COMPLETED,
            details: {},
          },
        });
      case MeetingStatus.CANCELLED:
        throw new ConflictException({
          success: false,
          message: 'Cuộc họp đã bị hủy',
          error: { code: MEETING_START_ERRORS.MEETING_CANCELLED, details: {} },
        });
      case MeetingStatus.PENDING_APPROVAL:
        throw new ConflictException({
          success: false,
          message: 'Cuộc họp đang chờ phê duyệt',
          error: {
            code: MEETING_START_ERRORS.MEETING_PENDING_APPROVAL,
            details: {},
          },
        });
      case MeetingStatus.DRAFT:
        throw new ConflictException({
          success: false,
          message: 'Cuộc họp chưa được lên lịch',
          error: {
            code: MEETING_START_ERRORS.MEETING_IN_DRAFT_STATUS,
            details: {},
          },
        });
      case MeetingStatus.IN_PROGRESS:
        // actualStartTime check handles idempotent path
        break;
      case MeetingStatus.SCHEDULED:
        // Time window check
        const windowStart = new Date(
          meeting.startTime.getTime() - 15 * 60 * 1000,
        );
        if (now < windowStart) {
          throw new ConflictException({
            success: false,
            message: 'Chưa đến thời gian bắt đầu phiên họp',
            error: {
              code: MEETING_START_ERRORS.MEETING_START_TOO_EARLY,
              details: { allowedFrom: windowStart.toISOString() },
            },
          });
        }
        if (now >= meeting.endTime) {
          throw new ConflictException({
            success: false,
            message: 'Đã quá thời gian bắt đầu phiên họp',
            error: {
              code: MEETING_START_ERRORS.MEETING_START_WINDOW_EXPIRED,
              details: { expiredAt: meeting.endTime.toISOString() },
            },
          });
        }
        break;
      default:
        throw new ConflictException({
          success: false,
          message: 'Cuộc họp không ở trạng thái scheduled',
          error: {
            code: MEETING_START_ERRORS.MEETING_NOT_IN_SCHEDULED_STATUS,
            details: { currentStatus: meeting.status },
          },
        });
    }
  }

  /**
   * ───────────────────────────────────────────────────────────
   *  Private: Core transaction với SELECT FOR UPDATE
   * ───────────────────────────────────────────────────────────
   */
  private async executeStartMeetingInTransaction(
    meetingId: string,
    sourceType: MeetingEventSourceType,
    actorUserId: string | null,
    clientContext: ClientContext,
  ): Promise<Date> {
    try {
      return await this.dataSource.transaction(async (em) => {
        // 1. Lock meeting row
        const lockedMeeting = await em
          .createQueryBuilder(MeetingEntity, 'm')
          .setLock('pessimistic_write')
          .where('m.id = :id', { id: meetingId })
          .getOne();

        if (!lockedMeeting || lockedMeeting.deletedAt) {
          throw new NotFoundException({
            success: false,
            message: 'Không tìm thấy cuộc họp',
            error: {
              code: MEETING_START_ERRORS.MEETING_NOT_FOUND,
              details: { meetingId },
            },
          });
        }

        // 2. Re-validate after lock
        if (lockedMeeting.actualStartTime) {
          throw new ConflictException({
            success: false,
            message: 'Cuộc họp đã được bắt đầu bởi một yêu cầu khác',
            error: {
              code: MEETING_START_ERRORS.MEETING_ALREADY_STARTED,
              details: { meetingId },
            },
          });
        }

        this.validateMeetingCanStart(lockedMeeting);

        const now = new Date();
        const actualStartTime = now;

        // 3. UPDATE meetings
        await em.update(
          MeetingEntity,
          { id: meetingId },
          {
            status: MeetingStatus.IN_PROGRESS as any,
            actualStartTime,
            updatedBy: actorUserId,
            updatedAt: now,
          },
        );

        // 4. INSERT meeting_events
        const oldValue = {
          status: MeetingStatus.SCHEDULED,
          actualStartTime: null,
        };
        const newValue = {
          status: MeetingStatus.IN_PROGRESS,
          actualStartTime: actualStartTime.toISOString(),
        };

        const event = em.create(MeetingEventEntity, {
          meetingId,
          eventType: MeetingEventType.MEETING_STARTED,
          eventTime: now,
          actorUserId,
          sourceType,
          description: 'Phiên họp bắt đầu',
          oldValueJson: oldValue,
          newValueJson: newValue,
        });
        await em.save(MeetingEventEntity, event);

        // 5. UPDATE room_bookings (approved → active)
        await em.update(
          RoomBookingEntity,
          {
            meetingId,
            status: RoomBookingStatus.APPROVED,
          },
          {
            status: RoomBookingStatus.ACTIVE,
          },
        );

        // 6. UPDATE room_booking_usages (not_started → in_use)
        const occupancySource =
          sourceType === MeetingEventSourceType.DEVICE
            ? OccupancySource.CAMERA
            : OccupancySource.MANUAL;

        await em.update(
          RoomBookingUsageEntity,
          {
            meetingId,
            usageStatus: RoomUsageStatus.NOT_STARTED,
          },
          {
            usageStatus: RoomUsageStatus.IN_USE,
            actualStartTime,
            occupancySource,
          },
        );

        // 7. INSERT audit_logs
        const auditLog = em.create(AuditLogEntity, {
          userId: actorUserId,
          actionType: 'start_meeting',
          entityType: 'meeting',
          entityId: meetingId,
          oldValueJson: oldValue,
          newValueJson: newValue,
          ipAddress: clientContext.ipAddress ?? null,
          userAgent: clientContext.userAgent ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);

        this.logger.log(
          `[StartMeeting] Meeting ${meetingId} started successfully (source=${sourceType})`,
        );

        return actualStartTime;
      });
    } catch (error: unknown) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error(
        `[StartMeeting] Transaction failed for meeting ${meetingId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /**
   * ───────────────────────────────────────────────────────────
   *  Private: WebSocket push (best-effort)
   * ───────────────────────────────────────────────────────────
   */
  private emitMeetingStartedEvent(
    meetingId: string,
    actualStartTime: Date,
    scheduledStartTime: Date,
    scheduledEndTime: Date,
    roomId: string | undefined,
    startedBy: string | null,
  ): void {
    try {
      this.websocketService.emitToRoom(
        `meeting:${meetingId}`,
        'meeting.session.started',
        {
          eventType: 'meeting.session.started',
          data: {
            meetingId,
            status: MeetingStatus.IN_PROGRESS,
            actualStartTime: actualStartTime.toISOString(),
            scheduledStartTime: scheduledStartTime.toISOString(),
            scheduledEndTime: scheduledEndTime.toISOString(),
            roomId,
            startedBy,
            occurredAt: new Date().toISOString(),
          },
        },
      );
    } catch (error: unknown) {
      this.logger.error(
        `[WS] Failed to emit meeting.session.started for meeting ${meetingId}: ${(error as Error).message}`,
      );
      // Best-effort — không throw
    }
  }

  // ───────────────────────────────────────────────────────────
  //  UC-IMM-02: Extension request logic
  // ───────────────────────────────────────────────────────────

  /**
   * Load extension policy tu system_configs.
   * Fallback ve DEFAULT_EXTENSION_POLICY neu khong tim thay config.
   */
  async loadExtensionPolicy(): Promise<ExtensionPolicy> {
    try {
      const config = await this.dataSource
        .getRepository(SystemConfigEntity)
        .findOne({
          where: {
            configKey: 'meeting.extension.policy',
            configGroup: 'scheduling',
          },
        });

      if (!config?.configJson) {
        this.logger.log('[ExtensionPolicy] No config found, using defaults');
        return DEFAULT_EXTENSION_POLICY;
      }

      const json = config.configJson;

      const allowedExtensionMinutes =
        Array.isArray(json.allowedExtensionMinutes) &&
        (json.allowedExtensionMinutes as unknown[]).every(
          (v) => typeof v === 'number',
        )
          ? (json.allowedExtensionMinutes as number[])
          : DEFAULT_EXTENSION_POLICY.allowedExtensionMinutes;

      const maxExtensionCountPerMeeting =
        typeof json.maxExtensionCountPerMeeting === 'number' &&
        json.maxExtensionCountPerMeeting > 0
          ? json.maxExtensionCountPerMeeting
          : DEFAULT_EXTENSION_POLICY.maxExtensionCountPerMeeting;

      const maxTotalExtensionMinutesPerMeeting =
        typeof json.maxTotalExtensionMinutesPerMeeting === 'number' &&
        json.maxTotalExtensionMinutesPerMeeting > 0
          ? json.maxTotalExtensionMinutesPerMeeting
          : DEFAULT_EXTENSION_POLICY.maxTotalExtensionMinutesPerMeeting;

      return {
        allowedExtensionMinutes,
        maxExtensionCountPerMeeting,
        maxTotalExtensionMinutesPerMeeting,
      };
    } catch (error: unknown) {
      this.logger.error(
        `[ExtensionPolicy] Failed to load config, using defaults: ${(error as Error).message}`,
      );
      return DEFAULT_EXTENSION_POLICY;
    }
  }

  /**
   * Request extension cho meeting dang in_progress.
   * - No conflict: auto-apply path
   * - Conflict: pending path
   */
  async requestExtension(
    meetingId: string,
    dto: ExtensionRequestDto,
    authUser: AuthUser,
  ): Promise<ExtensionRequestResponseDto> {
    const policy = await this.loadExtensionPolicy();
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay cuoc hop',
        error: {
          code: MEETING_EXTENSION_ERRORS.MEETING_NOT_FOUND,
          details: { meetingId },
        },
      });
    }

    // Authorization — only Host
    if (meeting.hostId !== authUser.userId) {
      throw new ForbiddenException({
        success: false,
        message: 'Ban khong co quyen yeu cau gia han phien hop nay',
        error: {
          code: MEETING_EXTENSION_ERRORS.MEETING_EXTENSION_NOT_HOST,
          details: { required: 'must be host of the meeting' },
        },
      });
    }

    // Validate meeting status
    if (meeting.status !== MeetingStatus.IN_PROGRESS) {
      throw new ConflictException({
        success: false,
        message: 'Cuoc hop khong o trang thai in_progress',
        error: {
          code: MEETING_EXTENSION_ERRORS.MEETING_EXTENSION_NOT_IN_PROGRESS,
          details: { currentStatus: meeting.status },
        },
      });
    }

    // Validate room exists
    if (!meeting.roomId) {
      throw new ConflictException({
        success: false,
        message: 'Cuoc hop khong co phong hop',
        error: { code: 'MEETING_HAS_NO_ROOM', details: { meetingId } },
      });
    }

    // Validate extensionMinutes in allowed set
    if (!policy.allowedExtensionMinutes.includes(dto.extensionMinutes)) {
      throw new ConflictException({
        success: false,
        message: 'Thoi luong gia han khong hop le',
        error: {
          code: MEETING_EXTENSION_ERRORS.MEETING_EXTENSION_INVALID_DURATION,
          details: {
            allowedValues: policy.allowedExtensionMinutes,
            received: dto.extensionMinutes,
          },
        },
      });
    }

    // Check extension limits (count applied requests)
    const appliedRequests = await this.dataSource
      .getRepository(MeetingRequestEntity)
      .find({
        where: {
          meetingId,
          requestType: MeetingRequestType.EXTEND_MEETING,
          approvalStatus: ApprovalStatus.APPLIED,
        },
      });

    if (appliedRequests.length >= policy.maxExtensionCountPerMeeting) {
      throw new ConflictException({
        success: false,
        message: 'Da vuot qua gioi han so lan gia han',
        error: {
          code: MEETING_EXTENSION_ERRORS.MEETING_EXTENSION_LIMIT_EXCEEDED,
          details: {
            currentCount: appliedRequests.length,
            maxCount: policy.maxExtensionCountPerMeeting,
            limitType: 'count',
          },
        },
      });
    }

    // Check total extension minutes
    const totalExtensionMinutes = (
      await Promise.all(
        appliedRequests.map(async (req) => {
          const oldVal = req.requestPayloadJson as Record<
            string,
            unknown
          > | null;
          return (oldVal?.extensionMinutes as number) ?? 0;
        }),
      )
    ).reduce((sum, m) => sum + m, 0);

    if (
      totalExtensionMinutes + dto.extensionMinutes >
      policy.maxTotalExtensionMinutesPerMeeting
    ) {
      throw new ConflictException({
        success: false,
        message: 'Da vuot qua gioi han tong thoi gian gia han',
        error: {
          code: MEETING_EXTENSION_ERRORS.MEETING_EXTENSION_LIMIT_EXCEEDED,
          details: {
            currentTotal: totalExtensionMinutes,
            requested: dto.extensionMinutes,
            maxTotal: policy.maxTotalExtensionMinutesPerMeeting,
            limitType: 'total_minutes',
          },
        },
      });
    }

    // Calculate new end time
    const oldEndTime = meeting.endTime;
    const requestedNewEndTime = new Date(
      oldEndTime.getTime() + dto.extensionMinutes * 60 * 1000,
    );

    // Check active room booking
    const activeBooking = await this.dataSource
      .getRepository(RoomBookingEntity)
      .findOne({
        where: {
          meetingId,
          status: RoomBookingStatus.ACTIVE,
        },
      });

    if (!activeBooking) {
      throw new ConflictException({
        success: false,
        message: 'Khong tim thay phong dat active cho cuoc hop',
        error: {
          code: MEETING_EXTENSION_ERRORS.MEETING_EXTENSION_NO_ACTIVE_BOOKING,
          details: { meetingId },
        },
      });
    }

    // Check room conflict
    const conflictBookings = await this.dataSource
      .getRepository(RoomBookingEntity)
      .find({
        where: {
          roomId: meeting.roomId,
        },
      });

    const conflicts = conflictBookings.filter((b) => {
      if (b.id === activeBooking.id) return false;
      if (!['pending', 'approved', 'active'].includes(b.status)) return false;
      return (
        b.reservedStartTime < requestedNewEndTime &&
        b.reservedEndTime > oldEndTime
      );
    });

    if (conflicts.length > 0) {
      // PATH B: Pending (conflict)
      return this.handleConflictPath(
        meeting,
        activeBooking,
        oldEndTime,
        requestedNewEndTime,
        dto,
        authUser,
        conflicts,
        policy,
      );
    }

    // PATH A: Auto-apply (no conflict)
    return this.handleAutoApplyPath(
      meeting,
      activeBooking,
      oldEndTime,
      requestedNewEndTime,
      dto,
      authUser,
    );
  }
  // ───────────────────────────────────────────────────────────
  //  UC-IMM-02: Auto-apply path (no conflict)
  // ───────────────────────────────────────────────────────────

  private async handleAutoApplyPath(
    meeting: MeetingEntity,
    activeBooking: RoomBookingEntity,
    oldEndTime: Date,
    newEndTime: Date,
    dto: ExtensionRequestDto,
    authUser: AuthUser,
  ): Promise<ExtensionRequestResponseDto> {
    const policy = await this.loadExtensionPolicy();
    const now = new Date();
    const requestCode = `EXT-${meeting.meetingCode}-${now.getTime()}`;

    try {
      return await this.dataSource.transaction(async (em) => {
        // 1. Lock meeting row
        const lockedMeeting = await em
          .createQueryBuilder(MeetingEntity, 'm')
          .setLock('pessimistic_write')
          .where('m.id = :id', { id: meeting.id })
          .getOne();

        if (!lockedMeeting || lockedMeeting.deletedAt) {
          throw new NotFoundException({
            success: false,
            message: 'Khong tim thay cuoc hop',
            error: {
              code: MEETING_EXTENSION_ERRORS.MEETING_NOT_FOUND,
              details: { meetingId: meeting.id },
            },
          });
        }

        // Re-validate
        if (lockedMeeting.status !== MeetingStatus.IN_PROGRESS) {
          throw new ConflictException({
            success: false,
            message: 'Cuoc hop khong con o trang thai in_progress',
            error: {
              code: MEETING_EXTENSION_ERRORS.MEETING_EXTENSION_NOT_IN_PROGRESS,
              details: {},
            },
          });
        }

        // 2. INSERT meeting_requests
        const requestPayload = {
          extensionMinutes: dto.extensionMinutes,
          reason: dto.reason ?? null,
          oldEndTime: oldEndTime.toISOString(),
          requestedNewEndTime: newEndTime.toISOString(),
        };

        const requestEntity = em.create(MeetingRequestEntity, {
          requestCode,
          meetingId: meeting.id,
          requestType: MeetingRequestType.EXTEND_MEETING,
          requestedBy: authUser.userId,
          requestedAt: now,
          requestedEndTime: newEndTime,
          approvalMode: ApprovalMode.AUTO,
          approvalStatus: ApprovalStatus.APPLIED,
          conflictCheckStatus: ConflictCheckStatus.CLEAR,
          conflictCheckedAt: now,
          requestPayloadJson: requestPayload,
          appliedAt: now,
          notes: 'Auto-approved: room available',
        });
        await em.save(MeetingRequestEntity, requestEntity);

        // 3. UPDATE meetings.end_time
        await em.update(
          MeetingEntity,
          { id: meeting.id },
          {
            endTime: newEndTime,
            updatedBy: authUser.userId,
            updatedAt: now,
          },
        );

        // 4. UPDATE room_bookings.reserved_end_time
        await em.update(
          RoomBookingEntity,
          { id: activeBooking.id },
          { reservedEndTime: newEndTime },
        );

        // 5. UPDATE room_booking_usages (if exists)
        await em.update(
          RoomBookingUsageEntity,
          {
            meetingId: meeting.id,
            usageStatus: RoomUsageStatus.IN_USE,
          },
          { reservedEndTime: newEndTime },
        );

        await em.update(
          RoomBookingUsageEntity,
          {
            meetingId: meeting.id,
            usageStatus: RoomUsageStatus.NOT_STARTED,
          },
          { reservedEndTime: newEndTime },
        );

        // 6. INSERT meeting_events
        const oldValue = { endTime: oldEndTime.toISOString() };
        const newValue = {
          endTime: newEndTime.toISOString(),
          extensionMinutes: dto.extensionMinutes,
        };

        const event = em.create(MeetingEventEntity, {
          meetingId: meeting.id,
          eventType: MeetingEventType.EXTENSION_REQUESTED,
          eventTime: now,
          actorUserId: authUser.userId,
          sourceType: MeetingEventSourceType.MANUAL,
          description: 'Gia han phien hop',
          oldValueJson: oldValue,
          newValueJson: newValue,
          metadataJson: {
            requestId: requestEntity.id,
            conflictCheckStatus: 'clear',
          },
        });
        await em.save(MeetingEventEntity, event);

        // 7. INSERT audit_logs
        const auditLog = em.create(AuditLogEntity, {
          userId: authUser.userId,
          actionType: 'extend_meeting',
          entityType: 'meeting',
          entityId: meeting.id,
          oldValueJson: oldValue,
          newValueJson: newValue,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);

        this.logger.log(
          `[Extension] Auto-applied for meeting ${meeting.id}: +${dto.extensionMinutes}m (request ${requestEntity.id})`,
        );

        return new ExtensionRequestResponseDto({
          requestId: requestEntity.id,
          meetingId: meeting.id,
          oldEndTime: oldEndTime.toISOString(),
          newEndTime: newEndTime.toISOString(),
          extensionMinutes: dto.extensionMinutes,
          approvalMode: 'auto',
          status: 'applied',
          conflictCheckStatus: 'clear',
        });
      });

      // Post-commit: reschedule warning job (UC-IMM-12, best-effort)
      try {
        await this.rescheduleWarningJob(meeting.id);
      } catch (reschedErr: unknown) {
        this.logger.error(
          '[handleAutoApplyPath] rescheduleWarningJob failed: ' +
            (reschedErr as Error).message,
        );
      }
    } catch (error: unknown) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error(
        `[Extension] Auto-apply transaction failed for meeting ${meeting.id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  // ───────────────────────────────────────────────────────────
  //  UC-IMM-02: Conflict/pending path
  // ───────────────────────────────────────────────────────────

  /**
   * Resolve approver for pending extension request.
   * Priority: direct_manager_id -> departments.manager_user_id -> role permission.
   */
  private async resolveApprover(hostId: string): Promise<string[]> {
    // Step 1: direct_manager_id
    const hostUser = await this.dataSource.getRepository(UserEntity).findOne({
      where: { id: hostId },
      relations: { directManager: true },
    });

    if (hostUser?.directManager?.id) {
      return [hostUser.directManager.id];
    }

    // Step 2: departments.manager_user_id
    if (hostUser?.departmentId) {
      const deptRepo = this.dataSource.getRepository(DepartmentEntity);
      const dept = await deptRepo.findOne({
        where: { id: hostUser.departmentId },
      });
      if (dept?.managerUserId) {
        return [dept.managerUserId];
      }
    }

    // Step 3: Find user with extension review permission (future)
    // TODO: Query role_permissions -> user_roles for a 'meeting.extension.review' permission

    throw new ConflictException({
      success: false,
      message:
        'Khong tim thay Manager/Approver hop le de xu ly yeu cau gia han bi xung dot',
      error: {
        code: MEETING_EXTENSION_ERRORS.MEETING_EXTENSION_NO_APPROVER,
        details: { hostId },
      },
    });
  }

  private async handleConflictPath(
    meeting: MeetingEntity,
    activeBooking: RoomBookingEntity,
    oldEndTime: Date,
    requestedNewEndTime: Date,
    dto: ExtensionRequestDto,
    authUser: AuthUser,
    conflicts: RoomBookingEntity[],
    policy: ExtensionPolicy,
  ): Promise<ExtensionRequestResponseDto> {
    // Resolve approver (throws 409 if none found)
    const approverIds = await this.resolveApprover(authUser.userId);
    const now = new Date();
    const requestCode = `EXT-${meeting.meetingCode}-${now.getTime()}-PENDING`;

    const conflictDetails = conflicts.map((c) => ({
      conflictingBookingId: c.id,
      conflictingMeetingId: c.meetingId,
      conflictStartTime: c.reservedStartTime.toISOString(),
      conflictEndTime: c.reservedEndTime.toISOString(),
    }));

    const requestPayload = {
      extensionMinutes: dto.extensionMinutes,
      reason: dto.reason ?? null,
      oldEndTime: oldEndTime.toISOString(),
      requestedNewEndTime: requestedNewEndTime.toISOString(),
      approvalExpiresAt: oldEndTime.toISOString(),
    };

    let requestId: string;

    try {
      const txResult = await this.dataSource.transaction(async (em) => {
        // 1. INSERT meeting_requests (pending)
        const requestEntity = em.create(MeetingRequestEntity, {
          requestCode,
          meetingId: meeting.id,
          requestType: MeetingRequestType.EXTEND_MEETING,
          requestedBy: authUser.userId,
          requestedAt: now,
          requestedEndTime: requestedNewEndTime,
          approvalMode: ApprovalMode.MANUAL,
          approvalStatus: ApprovalStatus.PENDING,
          conflictCheckStatus: ConflictCheckStatus.BLOCKED,
          conflictCheckedAt: now,
          conflictSummaryJson: {
            conflicts: conflictDetails,
            checkedAt: now.toISOString(),
          },
          requestPayloadJson: requestPayload,
          ruleSnapshotJson: {
            approverIds,
            approvalExpiresAt: oldEndTime.toISOString(),
          },
          notes: `Pending: room conflict, waiting manager (${approverIds.join(',')})`,
        });
        await em.save(MeetingRequestEntity, requestEntity);

        // 2. INSERT audit_logs
        const auditLog = em.create(AuditLogEntity, {
          userId: authUser.userId,
          actionType: 'extend_meeting_pending',
          entityType: 'meeting',
          entityId: meeting.id,
          oldValueJson: { endTime: oldEndTime.toISOString() },
          newValueJson: {
            requestedEndTime: requestedNewEndTime.toISOString(),
            extensionMinutes: dto.extensionMinutes,
            conflictStatus: 'blocked',
          },
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);

        this.logger.log(
          `[Extension] Pending request ${requestEntity.id} created for meeting ${meeting.id} (conflict)`,
        );

        return requestEntity.id;
      });

      requestId = txResult;
    } catch (error: unknown) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error(
        `[Extension] Pending transaction failed for meeting ${meeting.id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }

    // Post-transaction: Create notification for approvers (best-effort, throws if fails)
    try {
      const notificationPayload = {
        type: 'meeting_extension_request',
        title: 'Yeu cau gia han cuoc hop can xu ly',
        message: `Cuoc hop "${meeting.title}" dang yeu cau gia han them ${dto.extensionMinutes} phut nhung bi trung lich.`,
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        requestId,
        roomId: meeting.roomId,
        hostId: authUser.userId,
        oldEndTime: oldEndTime.toISOString(),
        requestedNewEndTime: requestedNewEndTime.toISOString(),
        extensionMinutes: dto.extensionMinutes,
        conflictCheckStatus: 'blocked',
        conflicts: conflictDetails,
        cta: {
          type: 'view_extension_request',
          label: 'Xem yeu cau gia han',
          target: `/meeting-requests/${requestId}`,
        },
      };

      const notifEntity = this.dataSource.manager.create(NotificationEntity, {
        notificationType: NotificationType.MEETING_REQUEST_CREATED,
        channel: NotificationChannel.IN_APP,
        subject: 'Yeu cau gia han cuoc hop',
        content: `Cuoc hop "${meeting.title}" yeu cau gia han ${dto.extensionMinutes} phut`,
        relatedEntityType: 'meeting_request',
        relatedEntityId: requestId,
        recipientScope: 'user_list',
        recipientUserIdsJson: approverIds,
        priority: NotificationPriority.HIGH,
        createdBy: authUser.userId,
        payloadJson: notificationPayload,
        deliveryStatus: 'draft' as any,
        retryCount: 0,
        readCount: 0,
      });
      await this.dataSource.manager.save(NotificationEntity, notifEntity);

      // WS push to manager (best-effort)
      for (const approverId of approverIds) {
        try {
          this.websocketService.emitToRoom(
            `user:${approverId}`,
            'meeting.extension.pending',
            {
              eventType: 'meeting.extension.pending',
              data: {
                meetingId: meeting.id,
                requestId,
                oldEndTime: oldEndTime.toISOString(),
                requestedNewEndTime: requestedNewEndTime.toISOString(),
                extensionMinutes: dto.extensionMinutes,
                requestedBy: authUser.userId,
                occurredAt: now.toISOString(),
              },
            },
          );
        } catch (wsError: unknown) {
          this.logger.error(
            `[Extension] WS push failed for user ${approverId}: ${(wsError as Error).message}`,
          );
        }
      }

      // WS push to meeting room
      try {
        this.websocketService.emitToRoom(
          `meeting:${meeting.id}`,
          'meeting.extension.pending',
          {
            eventType: 'meeting.extension.pending',
            data: {
              meetingId: meeting.id,
              requestId,
              oldEndTime: oldEndTime.toISOString(),
              requestedNewEndTime: requestedNewEndTime.toISOString(),
              extensionMinutes: dto.extensionMinutes,
              requestedBy: authUser.userId,
              occurredAt: now.toISOString(),
            },
          },
        );
      } catch (wsError: unknown) {
        this.logger.error(
          `[Extension] WS push failed for meeting ${meeting.id}: ${(wsError as Error).message}`,
        );
      }
    } catch (notifError: unknown) {
      this.logger.error(
        `[Extension] Failed to create notification for pending request ${requestId}: ${(notifError as Error).message}`,
      );
      throw new ConflictException({
        success: false,
        message: 'Loi gui thong bao den Manager',
        error: {
          code: MEETING_EXTENSION_ERRORS.MEETING_EXTENSION_MANAGER_NOTIFICATION_FAILED,
          details: { requestId, meetingId: meeting.id },
        },
      });
    }

    return new ExtensionRequestResponseDto({
      requestId,
      meetingId: meeting.id,
      oldEndTime: oldEndTime.toISOString(),
      requestedNewEndTime: requestedNewEndTime.toISOString(),
      extensionMinutes: dto.extensionMinutes,
      approvalMode: 'manual',
      status: 'pending',
      conflictCheckStatus: 'blocked',
      managerNotificationSent: true,
    });
  }

  // ───────────────────────────────────────────────────────────
  //  UC-IMM-03: Decide extension request (approve/reject)
  // ───────────────────────────────────────────────────────────

  /**
   * Validate extension request before processing decision.
   * Checks: request exists, request_type = extend_meeting, approval_status = pending.
   */
  private async validateDecideRequest(
    requestId: string,
    meetingId: string,
  ): Promise<MeetingRequestEntity> {
    const request = await this.dataSource
      .getRepository(MeetingRequestEntity)
      .findOne({
        where: {
          id: requestId,
          meetingId,
          requestType: MeetingRequestType.EXTEND_MEETING,
        },
      });

    if (!request) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay yeu cau gia han',
        error: {
          code: MEETING_EXTENSION_ERRORS.RESOURCE_NOT_FOUND,
          details: { requestId, meetingId },
        },
      });
    }

    if (request.approvalStatus !== ApprovalStatus.PENDING) {
      throw new ConflictException({
        success: false,
        message: 'Yeu cau gia han da duoc xu ly truoc do',
        error: {
          code: MEETING_EXTENSION_ERRORS.REQUEST_ALREADY_PROCESSED,
          details: {
            requestId,
            currentStatus: request.approvalStatus,
            processedAt: request.decisionAt?.toISOString() ?? null,
            decisionBy: request.decisionBy ?? null,
          },
        },
      });
    }

    return request;
  }

  /**
   * Check if the user has permission to decide on this extension request.
   */
  private async checkDecidePermission(
    request: MeetingRequestEntity,
    authUser: AuthUser,
    hasOverridePermission: boolean,
    hasDecidePermission: boolean,
  ): Promise<void> {
    if (hasOverridePermission) {
      return;
    }

    if (hasDecidePermission) {
      const ruleSnapshot = request.ruleSnapshotJson;
      const approverIds = (ruleSnapshot?.approverIds as string[]) ?? [];

      if (approverIds.includes(authUser.userId)) {
        return;
      }
    }

    throw new ForbiddenException({
      success: false,
      message: 'Ban khong co quyen xu ly yeu cau gia han nay',
      error: {
        code: 'PERMISSION_DENIED',
        details: {
          requestId: request.id,
        },
      },
    });
  }

  /**
   * Re-check room conflict for approve decision inside transaction.
   */
  private async checkRoomConflictForDecide(
    em: any,
    roomId: string,
    currentBookingId: string,
    oldEndTime: Date,
    requestedNewEndTime: Date,
  ): Promise<{
    hasConflict: boolean;
    conflicts: Array<Record<string, string>>;
  }> {
    const conflictBookings = await em
      .createQueryBuilder(RoomBookingEntity, 'rb')
      .where('rb.roomId = :roomId', { roomId })
      .andWhere('rb.id != :currentBookingId', { currentBookingId })
      .andWhere('rb.status IN (:...statuses)', {
        statuses: ['pending', 'approved', 'active'],
      })
      .andWhere('rb.deletedAt IS NULL')
      .andWhere('rb.reservedStartTime < :newEnd', {
        newEnd: requestedNewEndTime,
      })
      .andWhere('rb.reservedEndTime > :oldEnd', { oldEnd: oldEndTime })
      .getMany();

    if (conflictBookings.length === 0) {
      return { hasConflict: false, conflicts: [] };
    }

    const conflicts = conflictBookings.map((b: RoomBookingEntity) => ({
      conflictingMeetingId: b.meetingId,
      conflictingBookingId: b.id,
      conflictStartTime: b.reservedStartTime.toISOString(),
      conflictEndTime: b.reservedEndTime.toISOString(),
    }));

    return { hasConflict: true, conflicts };
  }

  /**
   * Send notification + WS after decision (best-effort).
   */
  private async notifyDecideResult(
    meetingId: string,
    requestId: string,
    decision: 'approved' | 'rejected',
    hostUserId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      const meeting = await this.dataSource
        .getRepository(MeetingEntity)
        .findOne({
          where: { id: meetingId },
        });

      const now = new Date();
      const isApproved = decision === 'approved';

      const notifPayload = {
        type: isApproved
          ? 'meeting_extension_approved'
          : 'meeting_extension_rejected',
        meetingId,
        meetingTitle: meeting?.title ?? '',
        requestId,
        ...details,
      };

      const notifEntity = this.dataSource.manager.create(NotificationEntity, {
        notificationType: isApproved
          ? NotificationType.MEETING_REQUEST_APPROVED
          : NotificationType.MEETING_REQUEST_REJECTED,
        channel: NotificationChannel.IN_APP,
        subject: isApproved
          ? 'Yeu cau gia han da duoc phe duyet'
          : 'Yeu cau gia han da bi tu choi',
        content: isApproved
          ? 'Yeu cau gia han phien hop cua ban da duoc phe duyet.'
          : 'Yeu cau gia han phien hop cua ban da bi tu choi.',
        relatedEntityType: 'meeting_request',
        relatedEntityId: requestId,
        recipientScope: 'user_list',
        recipientUserIdsJson: [hostUserId],
        priority: NotificationPriority.HIGH,
        payloadJson: notifPayload,
        deliveryStatus: 'draft' as any,
        retryCount: 0,
        readCount: 0,
      });
      await this.dataSource.manager.save(NotificationEntity, notifEntity);

      const eventType = isApproved
        ? 'meeting.extension.approved'
        : 'meeting.extension.rejected';
      const wsPayload = {
        eventType,
        data: {
          meetingId,
          requestId,
          occurredAt: now.toISOString(),
          ...details,
        },
      };

      try {
        this.websocketService.emitToRoom(
          'meeting:' + meetingId,
          eventType,
          wsPayload,
        );
      } catch (wsError: unknown) {
        this.logger.error(
          '[Decide] WS push failed for meeting ' +
            meetingId +
            ': ' +
            (wsError as Error).message,
        );
      }
    } catch (notifError: unknown) {
      this.logger.error(
        '[Decide] Notification/WS failed after decision for request ' +
          requestId +
          ': ' +
          (notifError as Error).message,
      );
    }
  }

  /**
   * UC-IMM-03: Phed duyet hoac tu choi yeu cau gia han phien hop.
   */
  async decideExtension(
    meetingId: string,
    requestId: string,
    dto: DecideExtensionDto,
    authUser: AuthUser,
    permissions: { hasDecide: boolean; hasOverride: boolean },
  ): Promise<DecideExtensionResponseDto> {
    const request = await this.validateDecideRequest(requestId, meetingId);
    await this.checkDecidePermission(
      request,
      authUser,
      permissions.hasOverride,
      permissions.hasDecide,
    );

    const decision = dto.decision;
    let rejectionReason: string | null = dto.reason ?? null;

    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay cuoc hop',
        error: {
          code: MEETING_EXTENSION_ERRORS.MEETING_NOT_FOUND,
          details: { meetingId },
        },
      });
    }

    const now = new Date();
    const requestPayload = request.requestPayloadJson as Record<
      string,
      unknown
    > | null;
    const oldEndTime = requestPayload?.oldEndTime
      ? new Date(requestPayload.oldEndTime as string)
      : meeting.endTime;
    const requestedNewEndTime = request.requestedEndTime ?? meeting.endTime;
    const extensionMinutes = (requestPayload?.extensionMinutes as number) ?? 0;

    let effectiveDecision: 'approved' | 'rejected' = decision;
    let conflictDetails: Record<string, unknown> | null = null;
    let outputNewEndTime: string | undefined;
    let outputExtensionMinutes: number | undefined;

    try {
      await this.dataSource.transaction(async (em) => {
        const lockedRequest = await em
          .createQueryBuilder(MeetingRequestEntity, 'mr')
          .setLock('pessimistic_write')
          .where('mr.id = :id', { id: requestId })
          .getOne();

        if (
          !lockedRequest ||
          lockedRequest.approvalStatus !== ApprovalStatus.PENDING
        ) {
          throw new ConflictException({
            success: false,
            message: 'Yeu cau gia han da duoc xu ly truoc do',
            error: {
              code: MEETING_EXTENSION_ERRORS.REQUEST_ALREADY_PROCESSED,
              details: {
                requestId,
                currentStatus: lockedRequest?.approvalStatus ?? 'not_found',
              },
            },
          });
        }

        if (effectiveDecision === 'approved') {
          const lockedMeeting = await em
            .createQueryBuilder(MeetingEntity, 'm')
            .setLock('pessimistic_write')
            .where('m.id = :id', { id: meetingId })
            .getOne();

          if (!lockedMeeting || lockedMeeting.deletedAt) {
            throw new NotFoundException({
              success: false,
              message: 'Khong tim thay cuoc hop',
              error: {
                code: MEETING_EXTENSION_ERRORS.MEETING_NOT_FOUND,
                details: { meetingId },
              },
            });
          }

          if (lockedMeeting.status !== MeetingStatus.IN_PROGRESS) {
            effectiveDecision = 'rejected';
            rejectionReason =
              'Cuoc hop khong con o trang thai dien ra (in_progress)';
          } else {
            const currentBooking = await em
              .createQueryBuilder(RoomBookingEntity, 'rb')
              .setLock('pessimistic_write')
              .where('rb.meetingId = :meetingId', { meetingId })
              .andWhere('rb.status IN (:...statuses)', {
                statuses: ['active', 'approved'],
              })
              .getOne();

            if (currentBooking) {
              const conflictResult = await this.checkRoomConflictForDecide(
                em,
                lockedMeeting.roomId!,
                currentBooking.id,
                oldEndTime,
                requestedNewEndTime,
              );

              if (conflictResult.hasConflict) {
                effectiveDecision = 'rejected';
                rejectionReason =
                  'Phong da co lich dat trong khoang thoi gian gia han';
                conflictDetails = {
                  conflicts: conflictResult.conflicts,
                  checkedAt: now.toISOString(),
                };
              } else {
                await em.update(
                  MeetingRequestEntity,
                  { id: requestId },
                  {
                    approvalStatus: ApprovalStatus.APPLIED,
                    decisionBy: authUser.userId,
                    decisionAt: now,
                    notes: 'Approved by ' + authUser.userId,
                  },
                );
                await em.update(
                  MeetingEntity,
                  { id: meetingId },
                  {
                    endTime: requestedNewEndTime,
                    updatedBy: authUser.userId,
                    updatedAt: now,
                  },
                );
                await em.update(
                  RoomBookingEntity,
                  { id: currentBooking.id },
                  { reservedEndTime: requestedNewEndTime },
                );
                await em.update(
                  RoomBookingUsageEntity,
                  { meetingId, usageStatus: RoomUsageStatus.IN_USE },
                  { reservedEndTime: requestedNewEndTime },
                );
                await em.update(
                  RoomBookingUsageEntity,
                  { meetingId, usageStatus: RoomUsageStatus.NOT_STARTED },
                  { reservedEndTime: requestedNewEndTime },
                );

                const approveEvent = em.create(MeetingEventEntity, {
                  meetingId,
                  eventType: MeetingEventType.EXTENSION_APPROVED,
                  eventTime: now,
                  actorUserId: authUser.userId,
                  sourceType: MeetingEventSourceType.MANUAL,
                  description: 'Yeu cau gia han da duoc phe duyet',
                  oldValueJson: { endTime: oldEndTime.toISOString() },
                  newValueJson: {
                    endTime: requestedNewEndTime.toISOString(),
                    extensionMinutes,
                  },
                  metadataJson: {
                    requestId,
                    decisionBy: authUser.userId,
                  },
                });
                await em.save(MeetingEventEntity, approveEvent);

                const approveAudit = em.create(AuditLogEntity, {
                  userId: authUser.userId,
                  actionType: 'extend_meeting',
                  entityType: 'meeting_request',
                  entityId: requestId,
                  oldValueJson: {
                    approvalStatus: ApprovalStatus.PENDING,
                  },
                  newValueJson: {
                    approvalStatus: ApprovalStatus.APPLIED,
                    newEndTime: requestedNewEndTime.toISOString(),
                    extensionMinutes,
                  },
                  severity: AuditLogSeverity.INFO,
                });
                await em.save(AuditLogEntity, approveAudit);

                outputNewEndTime = requestedNewEndTime.toISOString();
                outputExtensionMinutes = extensionMinutes;
                this.logger.log(
                  '[Decide] Approved extension for meeting ' +
                    meetingId +
                    ': +' +
                    extensionMinutes +
                    'm (request ' +
                    requestId +
                    ')',
                );
              }
            } else {
              effectiveDecision = 'rejected';
              rejectionReason = 'Khong tim thay phong dat active cho cuoc hop';
            }
          }
        }

        if (effectiveDecision === 'rejected') {
          const updateData: Record<string, unknown> = {
            approvalStatus: ApprovalStatus.REJECTED,
            decisionBy: authUser.userId,
            decisionAt: now,
            rejectionReason: rejectionReason ?? undefined,
            notes: 'Rejected by ' + authUser.userId,
          };
          if (conflictDetails) updateData.conflictSummaryJson = conflictDetails;
          await em.update(MeetingRequestEntity, { id: requestId }, updateData);

          const rejectEvent = em.create(MeetingEventEntity, {
            meetingId,
            eventType: MeetingEventType.EXTENSION_REJECTED,
            eventTime: now,
            actorUserId: authUser.userId,
            sourceType: MeetingEventSourceType.MANUAL,
            description: rejectionReason ?? 'Yeu cau gia han da bi tu choi',
            oldValueJson: { endTime: oldEndTime.toISOString() },
            newValueJson: {
              rejectionReason: rejectionReason ?? null,
            },
            metadataJson: { requestId, decisionBy: authUser.userId },
          });
          await em.save(MeetingEventEntity, rejectEvent);

          const rejectAudit = em.create(AuditLogEntity, {
            userId: authUser.userId,
            actionType: 'extend_meeting_reject',
            entityType: 'meeting_request',
            entityId: requestId,
            oldValueJson: { approvalStatus: ApprovalStatus.PENDING },
            newValueJson: {
              approvalStatus: ApprovalStatus.REJECTED,
              rejectionReason: rejectionReason ?? null,
            },
            severity: AuditLogSeverity.INFO,
          });
          await em.save(AuditLogEntity, rejectAudit);
          this.logger.log(
            '[Decide] Rejected extension for meeting ' +
              meetingId +
              ': ' +
              rejectionReason +
              ' (request ' +
              requestId +
              ')',
          );
        }
      });
    } catch (error: unknown) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error(
        '[Decide] Transaction failed for request ' +
          requestId +
          ': ' +
          (error as Error).message,
        (error as Error).stack,
      );
      throw error;
    }

    const hostId = meeting.hostId ?? request.requestedBy;
    const notifyDetails: Record<string, unknown> = {
      extensionMinutes: outputExtensionMinutes ?? extensionMinutes,
    };
    if (effectiveDecision === 'approved') {
      notifyDetails.newEndTime = outputNewEndTime;
    } else {
      notifyDetails.rejectionReason = rejectionReason;
    }
    await this.notifyDecideResult(
      meetingId,
      requestId,
      effectiveDecision,
      hostId,
      notifyDetails,
    );

    // Post-commit: reschedule warning job (UC-IMM-12, best-effort)
    if (effectiveDecision === 'approved') {
      try {
        await this.rescheduleWarningJob(meetingId);
      } catch (reschedErr: unknown) {
        this.logger.error(
          '[decideExtension] rescheduleWarningJob failed: ' +
            (reschedErr as Error).message,
        );
      }
    }

    const responseData = new DecideExtensionResponseDto({
      requestId,
      decision: effectiveDecision,
      status: effectiveDecision === 'approved' ? 'applied' : 'rejected',
      decisionAt: now.toISOString(),
      message:
        effectiveDecision === 'approved'
          ? 'Yeu cau gia han da duoc phe duyet.'
          : 'Yeu cau gia han da bi tu choi.' +
            (rejectionReason ? ' Ly do: ' + rejectionReason : ''),
    });
    if (effectiveDecision === 'approved') {
      responseData.oldEndTime = oldEndTime.toISOString();
      responseData.newEndTime = outputNewEndTime;
      responseData.extensionMinutes = outputExtensionMinutes;
    } else {
      responseData.rejectionReason = rejectionReason ?? undefined;
    }
    return responseData;
  }

  // ───────────────────────────────────────────────────────────
  //  UC-IMM-05: End Meeting Session
  // ───────────────────────────────────────────────────────────

  /**
   * Public API — Manual End (Normal Flow)
   */
  async endMeeting(
    meetingId: string,
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<EndMeetingResponseDto> {
    // ── Step 1: Load meeting ──
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay cuoc hop',
        error: {
          code: MEETING_END_ERRORS.MEETING_NOT_FOUND,
          details: { meetingId },
        },
      });
    }

    // ── Step 2: Authorization — Host, Organizer, or override ──
    if (
      meeting.organizerId !== authUser.userId &&
      meeting.hostId !== authUser.userId
    ) {
      // Check for override permission: meeting.session.end.any
      // (permission check is done at controller guard; here we verify ownership only)
      throw new ForbiddenException({
        success: false,
        message: 'Ban khong co quyen ket thuc phien hop nay',
        error: {
          code: MEETING_END_ERRORS.PERMISSION_DENIED,
          details: {
            required:
              'must be host or organizer of the meeting, or have meeting.session.end.any',
          },
        },
      });
    }

    // ── Step 3: Pre-validation ──
    this.validateMeetingCanEnd(meeting);

    // ── Step 4: Idempotent check ──
    if (meeting.actualEndTime) {
      throw new ConflictException({
        success: false,
        message: 'Cuoc hop da ket thuc truoc do',
        error: {
          code: MEETING_END_ERRORS.MEETING_ALREADY_COMPLETED,
          details: {
            meetingId,
            currentStatus: MeetingStatus.COMPLETED,
            actualEndTime: meeting.actualEndTime.toISOString(),
          },
        },
      });
    }

    // ── Step 5: Execute transaction ──
    const actualEndTime = await this.executeEndMeetingInTransaction(
      meetingId,
      meeting.endTime,
      MeetingEventSourceType.MANUAL,
      authUser.userId,
      clientContext,
    );

    // ── Step 6: Calculate response ──
    const meetingAfter = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({
        where: { id: meetingId },
      });

    const durationMinutes =
      meetingAfter && meetingAfter.actualStartTime
        ? Math.round(
            (actualEndTime.getTime() - meetingAfter.actualStartTime.getTime()) /
              60000,
          )
        : 0;

    const roomReleased = actualEndTime < meeting.endTime;

    // ── Step 7: Post-transaction — WebSocket push (best-effort) ──
    this.emitMeetingEndedEvent(
      meetingId,
      actualEndTime,
      meeting.startTime,
      meeting.endTime,
      meeting.roomId ?? undefined,
      authUser.userId,
      roomReleased,
    );

    // ── Step 8: Cancel warning job (UC-IMM-12, best-effort) ──
    try {
      await this.cancelWarningJob(meetingId);
    } catch (cancelErr: unknown) {
      this.logger.error(
        '[endMeeting] cancelWarningJob failed: ' + (cancelErr as Error).message,
      );
    }

    return new EndMeetingResponseDto({
      meetingId: meeting.id,
      status: MeetingStatus.COMPLETED,
      actualEndTime: actualEndTime.toISOString(),
      duration: durationMinutes,
      roomReleased,
    });
  }

  /**
   * Private: Core transaction voi SELECT FOR UPDATE
   */
  private async executeEndMeetingInTransaction(
    meetingId: string,
    originalEndTime: Date,
    sourceType: MeetingEventSourceType,
    actorUserId: string | null,
    clientContext: ClientContext,
  ): Promise<Date> {
    try {
      return await this.dataSource.transaction(async (em) => {
        // 1. Lock meeting row
        const lockedMeeting = await em
          .createQueryBuilder(MeetingEntity, 'm')
          .setLock('pessimistic_write')
          .where('m.id = :id', { id: meetingId })
          .getOne();

        if (!lockedMeeting || lockedMeeting.deletedAt) {
          throw new NotFoundException({
            success: false,
            message: 'Khong tim thay cuoc hop',
            error: {
              code: MEETING_END_ERRORS.MEETING_NOT_FOUND,
              details: { meetingId },
            },
          });
        }

        // 2. Re-validate after lock
        if (lockedMeeting.actualEndTime) {
          throw new ConflictException({
            success: false,
            message: 'Cuoc hop da duoc ket thuc boi mot yeu cau khac',
            error: {
              code: MEETING_END_ERRORS.MEETING_ALREADY_COMPLETED,
              details: { meetingId },
            },
          });
        }

        this.validateMeetingCanEnd(lockedMeeting);

        const now = new Date();
        const actualEndTime = now;
        const isEarlyEnd = actualEndTime < originalEndTime;

        // 3. UPDATE meetings
        await em.update(
          MeetingEntity,
          { id: meetingId },
          {
            status: MeetingStatus.COMPLETED as any,
            actualEndTime,
            updatedBy: actorUserId,
            updatedAt: now,
          },
        );

        // 4. INSERT meeting_events
        const oldValue = {
          status: MeetingStatus.IN_PROGRESS,
          actualEndTime: null,
        };
        const newValue = {
          status: MeetingStatus.COMPLETED,
          actualEndTime: actualEndTime.toISOString(),
        };

        const event = em.create(MeetingEventEntity, {
          meetingId,
          eventType: MeetingEventType.MEETING_ENDED,
          eventTime: now,
          actorUserId,
          sourceType,
          description: 'Phien hop ket thuc',
          oldValueJson: oldValue,
          newValueJson: newValue,
        });
        await em.save(MeetingEventEntity, event);

        // 5. UPDATE room_booking_usages
        const usageStatus = isEarlyEnd
          ? RoomUsageStatus.RELEASED
          : RoomUsageStatus.COMPLETED;
        await em.update(
          RoomBookingUsageEntity,
          {
            meetingId,
            usageStatus: RoomUsageStatus.IN_USE,
          },
          {
            usageStatus,
            actualEndTime,
          },
        );

        // 6. IF early end: release room
        if (isEarlyEnd) {
          // Update room_bookings
          await em.update(
            RoomBookingEntity,
            {
              meetingId,
              status: RoomBookingStatus.ACTIVE,
            },
            {
              status: RoomBookingStatus.COMPLETED,
            },
          );

          // Insert room_events
          const roomEvent = em.create(RoomEventEntity, {
            roomId: lockedMeeting.roomId!,
            meetingId,
            eventType: 'room_released_early',
            eventTime: now,
            sourceType: 'manual',
            actorUserId,
            oldStatus: RoomBookingStatus.ACTIVE,
            newStatus: RoomBookingStatus.COMPLETED,
            description:
              'Phong duoc giai phong som do cuoc hop ket thuc truoc gio',
          });
          await em.save(RoomEventEntity, roomEvent);
        }

        // 7. INSERT audit_logs
        const auditLog = em.create(AuditLogEntity, {
          userId: actorUserId,
          actionType: 'end_meeting',
          entityType: 'meeting',
          entityId: meetingId,
          oldValueJson: oldValue,
          newValueJson: newValue,
          ipAddress: clientContext.ipAddress ?? null,
          userAgent: clientContext.userAgent ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);

        this.logger.log(
          `[EndMeeting] Meeting ${meetingId} ended successfully (source=${sourceType}, earlyEnd=${isEarlyEnd})`,
        );

        return actualEndTime;
      });
    } catch (error: unknown) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error(
        `[EndMeeting] Transaction failed for meeting ${meetingId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /**
   * Private: Validate meeting co the end khong
   */
  private validateMeetingCanEnd(meeting: MeetingEntity): void {
    switch (meeting.status) {
      case MeetingStatus.COMPLETED:
        throw new ConflictException({
          success: false,
          message: 'Cuoc hop da ket thuc',
          error: {
            code: MEETING_END_ERRORS.MEETING_ALREADY_COMPLETED,
            details: {},
          },
        });
      case MeetingStatus.CANCELLED:
        throw new ConflictException({
          success: false,
          message: 'Cuoc hop da bi huy',
          error: { code: MEETING_END_ERRORS.MEETING_CANCELLED, details: {} },
        });
      case MeetingStatus.SCHEDULED:
        throw new ConflictException({
          success: false,
          message: 'Cuoc hop chua duoc bat dau',
          error: { code: MEETING_END_ERRORS.MEETING_NOT_STARTED, details: {} },
        });
      case MeetingStatus.IN_PROGRESS:
        // Valid status - allow
        break;
      default:
        throw new ConflictException({
          success: false,
          message: 'Trang thai cuoc hop khong hop le de ket thuc',
          error: {
            code: MEETING_END_ERRORS.MEETING_NOT_IN_PROGRESS,
            details: { currentStatus: meeting.status },
          },
        });
    }
  }

  /**
   * Private: WebSocket push (best-effort)
   */
  private emitMeetingEndedEvent(
    meetingId: string,
    actualEndTime: Date,
    scheduledStartTime: Date,
    scheduledEndTime: Date,
    roomId: string | undefined,
    endedBy: string | null,
    roomReleased: boolean,
  ): void {
    try {
      this.websocketService.emitToRoom(
        `meeting:${meetingId}`,
        'meeting.session.ended',
        {
          eventType: 'meeting.session.ended',
          data: {
            meetingId,
            status: MeetingStatus.COMPLETED,
            actualEndTime: actualEndTime.toISOString(),
            scheduledStartTime: scheduledStartTime.toISOString(),
            scheduledEndTime: scheduledEndTime.toISOString(),
            roomId,
            endedBy,
            occurredAt: new Date().toISOString(),
            roomReleased,
          },
        },
      );
    } catch (error: unknown) {
      this.logger.error(
        `[WS] Failed to emit meeting.session.ended for meeting ${meetingId}: ${(error as Error).message}`,
      );
      // Best-effort - khong throw
    }
  }

  // ------------------------------------------------------------------
  //  UC-IMM-07: View Live Meeting Participants
  // ------------------------------------------------------------------

  async getPresentAttendees(
    meetingId: string,
    authUser: AuthUser,
    clientContext: ClientContext,
    query: {
      search?: string;
      departmentId?: string;
      page: number;
      limit: number;
      sortBy: string;
      sortOrder: 'asc' | 'desc';
    },
  ): Promise<{
    data: PresentAttendeesResponseDto;
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const now = new Date();

    // Step 1: Load meeting
    const meetingRepo = this.dataSource.getRepository(MeetingEntity);
    const meeting = await meetingRepo.findOne({ where: { id: meetingId } });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay cuoc hop',
        error: {
          code: PRESENT_ATTENDEES_ERRORS.MEETING_NOT_FOUND,
          details: { meetingId },
        },
      });
    }

    // Step 2: Check status + time window
    const isInProgress = meeting.status === MeetingStatus.IN_PROGRESS;
    const isScheduledAndInWindow =
      meeting.status === MeetingStatus.SCHEDULED &&
      now >= meeting.startTime &&
      now <= new Date(meeting.endTime.getTime() + 30 * 60 * 1000);

    if (!isInProgress && !isScheduledAndInWindow) {
      throw new ConflictException({
        success: false,
        message: 'Cuoc hop chua dien ra hoac da ket thuc',
        error: {
          code: PRESENT_ATTENDEES_ERRORS.MEETING_NOT_IN_PROGRESS,
          details: {
            currentStatus: meeting.status,
            now: now.toISOString(),
            startTime: meeting.startTime.toISOString(),
          },
        },
      });
    }

    // Step 3: Authorization
    const isHost = meeting.hostId === authUser.userId;
    const participantRepo = this.dataSource.getRepository(
      MeetingParticipantEntity,
    );
    const hostParticipant = isHost
      ? null
      : await participantRepo.findOne({
          where: {
            meetingId,
            userId: authUser.userId,
            participantRole: ParticipantRole.HOST,
          },
        });
    const isHostViaParticipant = !!hostParticipant;
    const hasFullAccess = isHost || isHostViaParticipant;

    // Step 4: Query participants
    const participantQuery = this.dataSource
      .getRepository(MeetingParticipantEntity)
      .createQueryBuilder('mp')
      .innerJoinAndSelect('mp.user', 'u')
      .leftJoinAndSelect('u.department', 'd')
      .where('mp.meetingId = :meetingId', { meetingId })
      .andWhere('mp.userId IS NOT NULL')
      .andWhere('mp.invitationStatus != :declined', { declined: 'declined' });

    if (query.search && query.search.trim().length > 0) {
      const searchTerm = query.search.trim();
      participantQuery.andWhere(
        '(LOWER(u.fullName) LIKE :search OR LOWER(u.email) LIKE :search)',
        { search: '%' + searchTerm.toLowerCase() + '%' },
      );
    }
    if (query.departmentId) {
      participantQuery.andWhere('u.departmentId = :departmentId', {
        departmentId: query.departmentId,
      });
    }

    const total = await participantQuery.getCount();

    const sortByField = query.sortBy || 'u.fullName';
    const allowedSortBy = [
      'u.fullName',
      'd.departmentName',
      'mp.participantRole',
      'u.fullName',
    ];
    const safeSortBy = allowedSortBy.includes(sortByField)
      ? sortByField
      : 'u.fullName';
    const sortOrderDir = query.sortOrder === 'desc' ? 'DESC' : 'ASC';
    participantQuery.orderBy(safeSortBy, sortOrderDir);

    const page = query.page || 1;
    const limit = query.limit || 20;
    participantQuery.skip((page - 1) * limit).take(limit);

    const participants = await participantQuery.getMany();

    // Step 5: Enrich with attendance + presence data
    const presentUsers: PresentAttendeeItem[] = [];

    for (const mp of participants) {
      const user = mp.user as any;
      const department = user?.department;

      const arRepo = this.dataSource.getRepository(AttendanceRecordEntity);
      const attendanceRecord = await arRepo
        .findOne({
          where: { meetingId, userId: mp.userId },
          order: { updatedAt: 'DESC' as any },
        })
        .catch(() => null);

      let presenceSnapshot: any = null;
      if (meeting.roomId) {
        const psRepo = this.dataSource.getRepository(PresenceSnapshotEntity);
        presenceSnapshot = await psRepo
          .findOne({
            where: { roomId: meeting.roomId, userId: mp.userId },
            order: { snapshotTime: 'DESC' as any },
          })
          .catch(() => null);
      }

      // Step 6: Map presenceStatus
      let presenceStatus: PresenceStatus = PresenceStatus.UNKNOWN;
      if (presenceSnapshot?.presenceStatus === SnapshotPresenceStatus.PRESENT) {
        presenceStatus = PresenceStatus.PRESENT;
      } else if (
        attendanceRecord?.attendanceStatus === AttendanceRecordStatus.PRESENT ||
        attendanceRecord?.attendanceStatus === AttendanceRecordStatus.LATE
      ) {
        presenceStatus = PresenceStatus.PRESENT;
      } else if (
        presenceSnapshot?.presenceStatus ===
        SnapshotPresenceStatus.MAYBE_PRESENT
      ) {
        presenceStatus = PresenceStatus.MAYBE_PRESENT;
      } else if (
        attendanceRecord?.attendanceStatus === AttendanceRecordStatus.LEFT_EARLY
      ) {
        presenceStatus = PresenceStatus.LEFT;
      } else if (
        attendanceRecord?.attendanceStatus === AttendanceRecordStatus.ABSENT
      ) {
        presenceStatus = PresenceStatus.ABSENT;
      }

      // Step 7: Map presenceSource (FR-031 priority)
      let presenceSource: string | undefined;
      if (presenceSnapshot?.sourceType) {
        const st = String(presenceSnapshot.sourceType).toLowerCase();
        if (st === 'camera') presenceSource = 'room_camera';
        else if (st === 'manual') presenceSource = 'manual_host';
        else if (st === 'sensor') presenceSource = 'door_checkin';
        else presenceSource = st;
      } else if (attendanceRecord?.checkInMethod) {
        const cm = String(attendanceRecord.checkInMethod).toLowerCase();
        if (cm === 'door_camera') presenceSource = 'door_checkin';
        else if (cm === 'room_camera') presenceSource = 'room_camera';
        else if (cm === 'manual') presenceSource = 'manual_host';
        else presenceSource = cm;
      }

      // Step 8: Map joinedAt
      let joinedAt: string | undefined;
      if ((attendanceRecord as any)?.checkInTime) {
        joinedAt = new Date(
          (attendanceRecord as any).checkInTime,
        ).toISOString();
      } else if ((mp as any).joinedAt) {
        joinedAt = new Date((mp as any).joinedAt).toISOString();
      }

      // Step 9: Field-level authorization
      const isSelf = mp.userId === authUser.userId;

      const item: PresentAttendeeItem = {
        userId: mp.userId,
        fullName: user?.fullName || '',
        email: user?.email || undefined,
        departmentId: department?.id || undefined,
        departmentName: department?.departmentName || undefined,
        avatarUrl: user?.avatarUrl || undefined,
        participantRole: mp.participantRole,
        presenceStatus,
        presenceSource: hasFullAccess
          ? presenceSource
          : isSelf
            ? presenceSource
            : undefined,
        confidenceScore: hasFullAccess
          ? (presenceSnapshot?.confidenceScore ?? undefined)
          : undefined,
        checkInTime:
          hasFullAccess || isSelf
            ? (attendanceRecord as any)?.checkInTime
              ? new Date((attendanceRecord as any).checkInTime).toISOString()
              : undefined
            : undefined,
        joinedAt: hasFullAccess ? joinedAt : undefined,
        lastSeenAt:
          hasFullAccess && presenceSnapshot?.snapshotTime
            ? new Date(presenceSnapshot.snapshotTime).toISOString()
            : undefined,
      };

      presentUsers.push(item);
    }

    // Step 10: occupancyCount
    const occupancyCount = presentUsers.filter(
      (u) =>
        u.presenceStatus === PresenceStatus.PRESENT ||
        u.presenceStatus === PresenceStatus.MAYBE_PRESENT,
    ).length;

    // Step 11: Audit log (non-blocking)
    const auditRepo = this.dataSource.getRepository(AuditLogEntity);
    const auditLog = auditRepo.create({
      userId: authUser.userId,
      actionType: 'read_live_participants',
      entityType: 'meeting',
      entityId: meetingId,
      oldValueJson: null,
      newValueJson: {
        viewerUserId: authUser.userId,
        viewerRole: hasFullAccess ? 'host' : 'participant',
        resultCount: presentUsers.length,
        filters: {
          search: query.search || null,
          departmentId: query.departmentId || null,
        },
      },
      ipAddress: clientContext.ipAddress ?? null,
      userAgent: clientContext.userAgent ?? null,
      severity: 'info' as any,
    });
    auditRepo.save(auditLog).catch((err: Error) => {
      this.logger.error('[Audit] Failed to save audit log: ' + err.message);
    });

    const totalPages = Math.ceil(total / limit);

    return {
      data: new PresentAttendeesResponseDto({
        meetingId,
        occupancyCount,
        presentUsers,
        updatedAt: now.toISOString(),
      }),
      meta: { page, limit, total, totalPages },
    };
  }

  // ------------------------------------------------------------------
  //  UC-IMM-08: View Participant Attendance Status
  // ------------------------------------------------------------------

  async getMeetingAttendance(
    meetingId: string,
    authUser: AuthUser,
    clientContext: ClientContext,
    query: AttendanceQueryDto,
  ): Promise<MeetingAttendanceResponseDto> {
    const meetingRepo = this.dataSource.getRepository(MeetingEntity);
    const participantRepo = this.dataSource.getRepository(
      MeetingParticipantEntity,
    );
    const attendanceRecordRepo = this.dataSource.getRepository(
      AttendanceRecordEntity,
    );
    const attendanceEventRepo = this.dataSource.getRepository(
      AttendanceEventEntity,
    );
    const systemConfigRepo = this.dataSource.getRepository(SystemConfigEntity);
    const auditRepo = this.dataSource.getRepository(AuditLogEntity);

    // Step 1: Load meeting
    const meeting = await meetingRepo.findOne({ where: { id: meetingId } });
    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay cuoc hop',
        error: {
          code: MEETING_ATTENDANCE_ERRORS.MEETING_NOT_FOUND,
          details: { meetingId },
        },
      });
    }

    // Step 2: Check meeting status
    const allowedStatuses: string[] = ['in_progress', 'completed'];
    if (!allowedStatuses.includes(meeting.status)) {
      throw new ConflictException({
        success: false,
        message: 'Cuoc hop khong o trang thai hoat dong hoac da ket thuc',
        error: {
          code: MEETING_ATTENDANCE_ERRORS.MEETING_NOT_ACTIVE_OR_COMPLETED,
          details: {
            meetingId,
            currentStatus: meeting.status,
            allowedStatuses,
          },
        },
      });
    }

    // Step 3: Authorization
    const isHost = meeting.hostId === authUser.userId;
    let isHostViaParticipant = false;
    if (!isHost) {
      const hostP = await participantRepo.findOne({
        where: {
          meetingId,
          userId: authUser.userId,
          participantRole: 'host' as any,
        },
      });
      isHostViaParticipant = !!hostP;
    }

    // Step 4: Read late threshold from system_configs
    let lateThresholdMinutes = 10;
    try {
      const config = await systemConfigRepo.findOne({
        where: {
          configKey: 'attendance.late_threshold',
          isActive: true,
        },
      });
      if (config && config.configValue) {
        const parsed = parseInt(config.configValue || '10', 10);
        if (!isNaN(parsed) && parsed > 0) {
          lateThresholdMinutes = parsed;
        } else {
          this.logger.warn(
            '[Attendance] Invalid late_threshold value in system_configs, using default 10',
          );
        }
      }
    } catch {
      this.logger.warn(
        '[Attendance] Failed to read system_configs, using default late_threshold=10',
      );
    }

    // Step 5: Calculate late threshold time
    const baseTime = meeting.actualStartTime || meeting.startTime;
    const lateThresholdTime = new Date(
      baseTime.getTime() + lateThresholdMinutes * 60 * 1000,
    );
    const isMeetingInProgress = (meeting.status as string) === 'in_progress';

    // Step 6: Query participants (withDeleted to include soft-removed)
    const participantQuery = participantRepo
      .createQueryBuilder('mp')
      .withDeleted()
      .innerJoinAndSelect('mp.user', 'u')
      .leftJoinAndSelect('u.department', 'd')
      .where('mp.meetingId = :meetingId', { meetingId })
      .andWhere('mp.userId IS NOT NULL')
      .andWhere('mp.invitationStatus != :declined', { declined: 'declined' });

    // Apply search
    if (query.q && query.q.trim().length > 0) {
      const searchTerm = query.q.trim().toLowerCase();
      participantQuery.andWhere(
        '(LOWER(u.fullName) LIKE :search OR LOWER(u.email) LIKE :search)',
        { search: '%' + searchTerm + '%' },
      );
    }

    // Get total before pagination
    const totalRaw = await participantQuery.getCount();

    // Apply sort
    const allowedSortBy = ['full_name', 'attendance_status', 'check_in_time'];
    const safeSortBy =
      query.sortBy && allowedSortBy.includes(query.sortBy)
        ? query.sortBy
        : 'full_name';
    const sortOrderDir = query.sortOrder === 'desc' ? 'DESC' : 'ASC';
    const sortMap: Record<string, string> = {
      full_name: 'u.fullName',
      attendance_status: 'u.fullName',
      check_in_time: 'u.fullName',
    };
    participantQuery.orderBy(sortMap[safeSortBy] || 'u.fullName', sortOrderDir);

    // Apply pagination
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    participantQuery.skip((page - 1) * pageSize).take(pageSize);

    const participants = await participantQuery.getMany();

    // Step 7: Process each participant
    const items: AttendanceParticipantDto[] = [];

    for (const mp of participants) {
      const user = (mp as any).user;
      const department = user?.department;
      const isDeleted = !!(mp as any).deletedAt;

      // Get earliest valid check-in from attendance_records
      let earliestCheckIn: Date | null = null;
      let arStatus: string | null = null;

      const records = await attendanceRecordRepo.find({
        where: { meetingId: meetingId, userId: mp.userId },
        order: { checkInTime: 'ASC' },
        take: 50,
      });

      for (const rec of records) {
        const st = (rec as any).attendanceStatus;
        if (['present', 'late', 'absent'].includes(st)) {
          if (!earliestCheckIn) {
            earliestCheckIn = (rec as any).checkInTime || null;
          } else if (
            (rec as any).checkInTime &&
            (rec as any).checkInTime < earliestCheckIn
          ) {
            earliestCheckIn = (rec as any).checkInTime;
          }
          if (!arStatus || arStatus === 'present') {
            arStatus = st;
          }
        }
      }

      // Fallback: attendance_events
      if (!arStatus && !earliestCheckIn) {
        const eventResult = await attendanceEventRepo
          .createQueryBuilder('ae')
          .select('MIN(ae.eventTime)', 'minEventTime')
          .where('ae.meetingId = :meetingId', { meetingId })
          .andWhere('ae.userId = :userId', { userId: mp.userId })
          .andWhere('ae.eventType IN (:...types)', {
            types: ['check_in', 'enter_room'],
          })
          .getRawOne();
        if (eventResult?.minEventTime) {
          earliestCheckIn = new Date(eventResult.minEventTime);
        }
      }

      // Step 8: Classify attendance status
      let attendanceStatus: AttendanceStatus;
      let isProvisional = false;

      if (!arStatus && !earliestCheckIn) {
        attendanceStatus = AttendanceStatus.ABSENT;
        isProvisional = isMeetingInProgress;
      } else if (arStatus === 'absent') {
        attendanceStatus = AttendanceStatus.ABSENT;
      } else if (arStatus === 'late') {
        attendanceStatus = AttendanceStatus.LATE;
      } else if (arStatus === 'present' && earliestCheckIn) {
        if (earliestCheckIn > lateThresholdTime) {
          attendanceStatus = AttendanceStatus.LATE;
        } else {
          attendanceStatus = AttendanceStatus.CHECKED_IN;
        }
      } else {
        attendanceStatus = AttendanceStatus.CHECKED_IN;
      }

      // Step 9: Determine participantState
      let participantState: ParticipantState;
      if (isDeleted && earliestCheckIn) {
        participantState = ParticipantState.REMOVED;
      } else if (isDeleted && !earliestCheckIn) {
        continue;
      } else {
        participantState = ParticipantState.ACTIVE;
      }

      // Apply status filter
      if (
        query.status &&
        attendanceStatus !== (query.status as unknown as AttendanceStatus)
      ) {
        continue;
      }

      const dto = new AttendanceParticipantDto({
        userId: mp.userId,
        fullName: user?.fullName || '',
        email: user?.email || '',
        avatarUrl: user?.avatarUrl || null,
        departmentId: department?.id || null,
        departmentName: department?.departmentName || null,
        participantRole: mp.participantRole,
        attendanceStatus,
        checkInTime: earliestCheckIn ? earliestCheckIn.toISOString() : null,
        isProvisional,
        participantState,
      });
      items.push(dto);
    }

    // Step 10: Build meta
    const currentInvitedCount = items.filter(
      (p) => p.participantState === ParticipantState.ACTIVE,
    ).length;
    const checkedInCount = items.filter(
      (p) =>
        p.participantState === ParticipantState.ACTIVE &&
        p.attendanceStatus === AttendanceStatus.CHECKED_IN,
    ).length;
    const lateCount = items.filter(
      (p) =>
        p.participantState === ParticipantState.ACTIVE &&
        p.attendanceStatus === AttendanceStatus.LATE,
    ).length;
    const absentCount = items.filter(
      (p) =>
        p.participantState === ParticipantState.ACTIVE &&
        p.attendanceStatus === AttendanceStatus.ABSENT,
    ).length;
    const removedCount = items.filter(
      (p) => p.participantState === ParticipantState.REMOVED,
    ).length;
    const totalPages = Math.ceil(totalRaw / pageSize);

    const meta = new AttendanceMetaDto({
      page,
      pageSize,
      currentInvitedCount,
      checkedInCount,
      lateCount,
      absentCount,
      removedCount,
      totalPages,
    });

    // Step 11: Audit log non-blocking
    const auditLog = auditRepo.create({
      userId: authUser.userId,
      actionType: 'read_meeting_attendance',
      entityType: 'meeting',
      entityId: meetingId,
      oldValueJson: null,
      newValueJson: {
        viewerUserId: authUser.userId,
        resultCount: items.length,
        filters: { q: query.q || null, status: query.status || null },
      },
      ipAddress: clientContext.ipAddress ?? null,
      userAgent: clientContext.userAgent ?? null,
      severity: 'info' as any,
    });
    auditRepo.save(auditLog).catch((err: Error) => {
      this.logger.error('[Audit] Failed to save audit log: ' + err.message);
    });

    // Step 12: Return
    return new MeetingAttendanceResponseDto({
      meetingId,
      meetingStatus: meeting.status,
      actualStartTime: meeting.actualStartTime
        ? meeting.actualStartTime.toISOString()
        : null,
      lateThresholdMinutes,
      participants: items,
      meta,
    });
  }

  // ------------------------------------------------------------------
  //  UC-IMM-09: In-Meeting Notes - Helpers
  // ------------------------------------------------------------------

  /**
   * Resolve default visibility_level based on note_type (BR-005/006/007, FR-007).
   */
  private resolveDefaultVisibility(noteType: string): string {
    switch (noteType) {
      case 'host_note':
        return 'private';
      case 'in_meeting':
        return 'participants';
      case 'private':
        return 'private';
      default:
        return 'participants';
    }
  }

  /**
   * Check if user is host of a meeting via meeting_participants (BR-004).
   */
  private async isMeetingHost(
    em,
    meetingId: string,
    userId: string,
  ): Promise<boolean> {
    const { MeetingParticipantEntity } =
      await import('../../meetings/entities/meeting-participant.entity.js');
    const count = await em
      .createQueryBuilder(MeetingParticipantEntity, 'mp')
      .where('mp.meetingId = :meetingId', { meetingId })
      .andWhere('mp.userId = :userId', { userId })
      .andWhere('mp.participantRole = :role', { role: 'host' })
      .getCount();
    return count > 0;
  }

  // ------------------------------------------------------------------
  //  UC-IMM-09: Create Meeting Note (UC-102)
  // ------------------------------------------------------------------

  /**
   * Create a meeting note during an in_progress meeting.
   * Transaction + pessimistic_read lock on meeting (EC-001).
   */
  async createMeetingNote(
    meetingId: string,
    dto,
    authUser: AuthUser,
  ): Promise<any> {
    const { sanitizeNoteContent } =
      await import('../../../common/utils/sanitize-note-content.util.js');
    const { MEETING_NOTE_ERRORS } =
      await import('../constants/meeting-note-error.constant.js');
    const { MeetingNoteEntity } =
      await import('../../meetings/entities/meeting-note.entity.js');
    const { UserEntity } =
      await import('../../accounts/entities/user.entity.js');
    const { BadRequestException, InternalServerErrorException } =
      await import('@nestjs/common');

    const currentUserId = authUser.userId;

    // Sanitize content (NFR-005)
    const sanitized = sanitizeNoteContent(dto.content);
    if (!sanitized || sanitized.trim().length === 0) {
      throw new BadRequestException({
        success: false,
        message: 'Noi dung ghi chu khong duoc de trong',
        error: {
          code: MEETING_NOTE_ERRORS.VALIDATION_ERROR,
          details: { field: 'content', reason: 'empty_after_sanitize' },
        },
      });
    }

    // Reject system_note from user actor (FR-005, BR-003)
    if (dto.noteType === 'system_note') {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Loai ghi chu system_note khong duoc phep tu nguoi dung',
        error: {
          code: MEETING_NOTE_ERRORS.NOTE_SYSTEM_TYPE_FORBIDDEN,
          details: { noteType: dto.noteType },
        },
      });
    }

    // Transaction with pessimistic_read lock on meetings
    const result = await this.dataSource.transaction(async (em) => {
      // Load meeting with lock
      const meeting = await em
        .createQueryBuilder(MeetingEntity, 'm')
        .setLock('pessimistic_read')
        .where('m.id = :id', { id: meetingId })
        .getOne();

      if (!meeting || meeting.deletedAt) {
        throw new NotFoundException({
          success: false,
          message: 'Khong tim thay cuoc hop',
          error: {
            code: MEETING_NOTE_ERRORS.MEETING_NOT_FOUND,
            details: { meetingId },
          },
        });
      }

      // Check meeting status (BR-001)
      if (meeting.status !== MeetingStatus.IN_PROGRESS) {
        throw new ConflictException({
          success: false,
          message: 'Cuoc hop khong o trang thai dang dien ra',
          error: {
            code: MEETING_NOTE_ERRORS.MEETING_NOT_IN_PROGRESS,
            details: { currentStatus: meeting.status },
          },
        });
      }

      // Host check
      const isHost = await this.isMeetingHost(em, meetingId, currentUserId);

      // host_note requires host (FR-006, BR-004)
      if (dto.noteType === 'host_note' && !isHost) {
        throw new ForbiddenException({
          success: false,
          message: 'Chi Host moi duoc tao ghi chu host_note',
          error: { code: MEETING_NOTE_ERRORS.NOTE_HOST_ONLY, details: {} },
        });
      }

      // Resolve visibility level (FR-007/008)
      let visibilityLevel;
      if (dto.visibilityLevel) {
        visibilityLevel = dto.visibilityLevel;
      } else {
        visibilityLevel = this.resolveDefaultVisibility(dto.noteType);
      }

      // Resolve pinned (BR-009)
      let pinned = dto.pinned ?? false;
      if (pinned && !isHost) {
        pinned = false;
      }

      // INSERT meeting_notes
      const note = em.create(MeetingNoteEntity, {
        meetingId,
        authorId: currentUserId,
        noteType: dto.noteType,
        content: sanitized,
        pinned,
        visibilityLevel,
        sourceEventId: null,
      });
      const savedNote = await em.save(MeetingNoteEntity, note);
      return savedNote;
    });

    // Load note + author for response
    const noteRepo = this.dataSource.getRepository(MeetingNoteEntity);
    const noteWithAuthor = await noteRepo.findOne({
      where: { id: result.id },
      relations: { author: true },
    });

    if (!noteWithAuthor) {
      throw new InternalServerErrorException('Failed to load created note');
    }

    const author = noteWithAuthor.author;

    const { NoteResponseDto } = await import('../dto/note-response.dto.js');
    return new NoteResponseDto({
      id: noteWithAuthor.id,
      meetingId: noteWithAuthor.meetingId,
      noteType: noteWithAuthor.noteType,
      content: noteWithAuthor.content,
      pinned: noteWithAuthor.pinned,
      visibilityLevel: noteWithAuthor.visibilityLevel,
      author: {
        id: author?.id || currentUserId,
        fullName: author?.fullName || '',
      },
      createdAt:
        noteWithAuthor.createdAt?.toISOString() || new Date().toISOString(),
    });
  }

  // ------------------------------------------------------------------
  //  UC-IMM-09: List Meeting Notes (UC-103/104)
  // ------------------------------------------------------------------

  /**
   * Build visibility predicate for list query (BR-008, FR-014).
   * Author luon thay note cua minh.
   */
  private async buildVisibilityPredicate(
    qb,
    meetingId: string,
    currentUserId: string,
  ): Promise<void> {
    const { UserEntity } =
      await import('../../accounts/entities/user.entity.js');
    const { MeetingParticipantEntity } =
      await import('../../meetings/entities/meeting-participant.entity.js');

    // Get current user's department_id
    const currentUser = await this.dataSource
      .getRepository(UserEntity)
      .findOne({
        where: { id: currentUserId },
        select: { id: true, departmentId: true },
      });

    // Get participant list for this meeting
    const participantIds = await this.dataSource
      .getRepository(MeetingParticipantEntity)
      .createQueryBuilder('mp')
      .select('mp.userId')
      .where('mp.meetingId = :meetingId', { meetingId })
      .andWhere('mp.userId IS NOT NULL')
      .getMany();

    const participantUserIdSet = new Set(
      participantIds.map((p) => p.userId).filter(Boolean),
    );

    // Raw SQL conditions for visibility_level logic
    qb.andWhere(
      '(mn.authorId = :currentUserId' +
        ' OR mn.visibilityLevel = ' +
        'public_internal' +
        ' OR (mn.visibilityLevel = ' +
        'participants' +
        ' AND mn.authorId = ANY(:participantIds))' +
        ' OR (mn.visibilityLevel = ' +
        'department' +
        ' AND :departmentId IS NOT NULL AND' +
        '     EXISTS (SELECT 1 FROM users u WHERE u.id = mn.authorId AND u.departmentId = :departmentId))' +
        ' OR (mn.visibilityLevel = ' +
        'private' +
        ' AND mn.authorId = :currentUserId))',
      {
        currentUserId,
        participantIds: [...participantUserIdSet],
        departmentId: currentUser?.departmentId || null,
      },
    );

    // Always filter out soft-deleted notes (BR-010, FR-016)
    qb.andWhere('mn.deletedAt IS NULL');
  }

  /**
   * List meeting notes with filter, pagination, and full-text search (UC-103/104).
   */
  async listMeetingNotes(
    meetingId: string,
    query,
    authUser: AuthUser,
  ): Promise<any> {
    const { MeetingNoteEntity } =
      await import('../../meetings/entities/meeting-note.entity.js');
    const { MeetingEntity } =
      await import('../../meetings/entities/meeting.entity.js');
    const { MEETING_NOTE_ERRORS } =
      await import('../constants/meeting-note-error.constant.js');
    const { NoteResponseDto } = await import('../dto/note-response.dto.js');

    // Verify meeting exists
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });
    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay cuoc hop',
        error: {
          code: MEETING_NOTE_ERRORS.MEETING_NOT_FOUND,
          details: { meetingId },
        },
      });
    }

    // Build query
    const noteRepo = this.dataSource.getRepository(MeetingNoteEntity);
    const qb = noteRepo
      .createQueryBuilder('mn')
      .leftJoinAndSelect('mn.author', 'u')
      .where('mn.meetingId = :meetingId', { meetingId });

    // Visibility filter (FR-014, FR-018)
    await this.buildVisibilityPredicate(qb, meetingId, authUser.userId);

    // Optional filters (FR-015)
    if (query.noteType) {
      qb.andWhere('mn.noteType = :noteType', { noteType: query.noteType });
    }
    if (query.pinned !== undefined) {
      qb.andWhere('mn.pinned = :pinned', { pinned: query.pinned });
    }

    // Full-text search (FR-017)
    if (query.q && query.q.trim().length > 0) {
      qb.andWhere(
        "to_tsvector('simple', mn.content) @@ plainto_tsquery('simple', :q)",
        { q: query.q.trim() },
      );
    }

    // Pagination
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const total = await qb.getCount();
    qb.skip(skip).take(limit);
    qb.orderBy('mn.createdAt', 'DESC');

    const notes = await qb.getMany();

    // Map to DTO
    const data = notes.map((note) => {
      const author = note.author;
      return new NoteResponseDto({
        id: note.id,
        meetingId: note.meetingId,
        noteType: note.noteType,
        content: note.content,
        pinned: note.pinned,
        visibilityLevel: note.visibilityLevel,
        author: {
          id: author?.id || '',
          fullName: author?.fullName || '',
        },
        createdAt: note.createdAt?.toISOString() || '',
      });
    });

    const totalPages = Math.ceil(total / limit);

    return { data, meta: { page, limit, total, totalPages } };
  }

  // ------------------------------------------------------------------
  //  UC-99: View Meeting Timeline (READ-only, gộp 3 nguồn)
  // ------------------------------------------------------------------

  /**
   * UC-99 — Timeline cuộc họp: gộp meeting_events (start/end/warning/extension_*)
   * + attendance_events (check_in/check_out) + meeting_notes (theo visibility)
   * thành 1 danh sách sắp theo thời gian, phân trang.
   *
   * - Quyền theo QUAN HỆ: host/participant của meeting (GỌI resolveMeetingRole).
   * - Note-visibility BẮT BUỘC: GỌI buildVisibilityPredicate (không chép SQL).
   * - App-merge: query 3 nguồn → gộp → sort → slice; total = tổng row hợp lệ.
   * - READ-only, không mutation. KHÔNG sửa listMeetingNotes/2 private helper.
   */
  async getMeetingTimeline(
    meetingId: string,
    query: TimelineQueryDto,
    currentUserId: string,
  ): Promise<{
    data: TimelineItemDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const sortDir: 'asc' | 'desc' = query.sort === 'desc' ? 'desc' : 'asc';
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;

    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException({
        success: false,
        message: 'Khoang thoi gian khong hop le (from > to)',
        error: { code: 'INVALID_DATE_RANGE', details: {} },
      });
    }

    // ── A. Load meeting (404) ──
    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({ where: { id: meetingId } });
    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay cuoc hop',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }

    // ── B. Quyền quan hệ: host HOẶC participant (GỌI resolveMeetingRole) ──
    const participant = await this.dataSource
      .getRepository(MeetingParticipantEntity)
      .findOne({ where: { meetingId, userId: currentUserId } });
    const role = this.resolveMeetingRole(meeting, participant, currentUserId);
    if (!role.isHost && !role.isParticipant) {
      throw new ForbiddenException({
        success: false,
        message: 'Ban khong phai host/participant cua cuoc hop nay',
        error: { code: 'NOT_A_MEETING_PARTICIPANT', details: {} },
      });
    }

    const types = query.types
      ? query.types
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : null;
    const wantCategory = (c: string): boolean => !types || types.includes(c);

    const items: Array<{
      time: Date;
      category: 'meeting_event' | 'attendance' | 'note';
      type: string;
      actorUserId: string | null;
      detail: string | null;
      refId: string;
    }> = [];

    // ── C1. meeting_events (start/end/warning/extension_*) ──
    if (wantCategory('meeting_event')) {
      const MEETING_EVENT_TYPES = [
        MeetingEventType.MEETING_STARTED,
        MeetingEventType.MEETING_ENDED,
        MeetingEventType.WARNING_SENT,
        MeetingEventType.EXTENSION_REQUESTED,
        MeetingEventType.EXTENSION_APPROVED,
        MeetingEventType.EXTENSION_REJECTED,
      ];
      const meQb = this.dataSource
        .getRepository(MeetingEventEntity)
        .createQueryBuilder('me')
        .where('me.meetingId = :meetingId', { meetingId })
        .andWhere('me.eventType IN (:...types)', {
          types: MEETING_EVENT_TYPES,
        });
      if (from) meQb.andWhere('me.eventTime >= :from', { from });
      if (to) meQb.andWhere('me.eventTime <= :to', { to });
      const events = await meQb.getMany();
      for (const e of events) {
        items.push({
          time: e.eventTime,
          category: 'meeting_event',
          type: e.eventType,
          actorUserId: e.actorUserId,
          detail: e.description,
          refId: e.id,
        });
      }
    }

    // ── C2. attendance_events (check_in/check_out) ──
    if (wantCategory('attendance')) {
      const aeQb = this.dataSource
        .getRepository(AttendanceEventEntity)
        .createQueryBuilder('ae')
        .where('ae.meetingId = :meetingId', { meetingId })
        .andWhere('ae.eventType IN (:...types)', {
          types: ['check_in', 'check_out'],
        });
      if (from) aeQb.andWhere('ae.eventTime >= :from', { from });
      if (to) aeQb.andWhere('ae.eventTime <= :to', { to });
      const atts = await aeQb.getMany();
      for (const a of atts) {
        items.push({
          time: a.eventTime,
          category: 'attendance',
          type: a.eventType,
          actorUserId: a.userId,
          detail: null,
          refId: a.id,
        });
      }
    }

    // ── C3. meeting_notes (BẮT BUỘC qua buildVisibilityPredicate) ──
    if (wantCategory('note')) {
      const mnQb = this.dataSource
        .getRepository(MeetingNoteEntity)
        .createQueryBuilder('mn')
        .where('mn.meetingId = :meetingId', { meetingId });
      // GỌI helper hiện có — KHÔNG chép/lỏng hơn logic visibility.
      await this.buildVisibilityPredicate(mnQb, meetingId, currentUserId);
      if (from) mnQb.andWhere('mn.createdAt >= :from', { from });
      if (to) mnQb.andWhere('mn.createdAt <= :to', { to });
      const notes = await mnQb.getMany();
      for (const n of notes) {
        items.push({
          time: n.createdAt,
          category: 'note',
          type: 'note',
          actorUserId: n.authorId,
          detail: n.content,
          refId: n.id,
        });
      }
    }

    // ── E. Merge + sort + slice ──
    items.sort((x, y) =>
      sortDir === 'asc'
        ? x.time.getTime() - y.time.getTime()
        : y.time.getTime() - x.time.getTime(),
    );
    const total = items.length;
    const pageItems = items.slice((page - 1) * limit, page * limit);

    // ── Batch actorName (1 query, tránh N+1) ──
    const actorIds = [
      ...new Set(
        pageItems
          .map((i) => i.actorUserId)
          .filter((x): x is string => x != null),
      ),
    ];
    const nameMap = new Map<string, string>();
    if (actorIds.length > 0) {
      const users = await this.dataSource
        .getRepository(UserEntity)
        .createQueryBuilder('u')
        .select(['u.id', 'u.fullName'])
        .where('u.id IN (:...ids)', { ids: actorIds })
        .getMany();
      for (const u of users) nameMap.set(u.id, u.fullName);
    }

    const data: TimelineItemDto[] = pageItems.map((i) => ({
      time: i.time.toISOString(),
      category: i.category,
      type: i.type,
      actorUserId: i.actorUserId,
      actorName: i.actorUserId ? (nameMap.get(i.actorUserId) ?? null) : null,
      detail: i.detail,
      refId: i.refId,
    }));

    return { data, total, page, limit };
  }

  // ------------------------------------------------------------------
  //  UC-IMM-10: View Meeting Notes - Helpers
  // ------------------------------------------------------------------

  /**
   * Xac dinh role cua user trong meeting (T007).
   * Return { isHost, isParticipant }.
   * isHost = meeting.host_id === currentUserId OR participant?.participantRole === 'host'.
   * isParticipant = participant record ton tai.
   */
  private resolveMeetingRole(
    meeting: { hostId: string | null },
    participant: { participantRole?: string } | null,
    currentUserId: string,
  ): { isHost: boolean; isCoHost: boolean; isParticipant: boolean } {
    const isHost =
      meeting.hostId === currentUserId ||
      participant?.participantRole === 'host';
    const isCoHost = !isHost && participant?.participantRole === 'co_host';
    const isParticipant = participant !== null;
    return { isHost, isCoHost, isParticipant };
  }

  // ------------------------------------------------------------------
  //  UC-IMM-11: Search Meeting Notes helpers
  // ------------------------------------------------------------------

  /**
   * Escape wildcard characters cho ILIKE fallback (T008, CR-004, BR-022).
   * Escape %, _, \ trong keyword truoc khi bind vao ILIKE query.
   */
  private escapeIlikeWildcard(keyword: string): string {
    return keyword.replace(/[\\%_]/g, '\\$&');
  }

  /**
   * Normalize Vietnamese text bang cach loai bo dau (T009).
   * Application-layer fallback khi DB khong co unaccent extension.
   */
  private normalizeVietnamese(text: string): string {
    const accentMap: Record<string, string> = {
      à: 'a',
      á: 'a',
      ả: 'a',
      ã: 'a',
      ạ: 'a',
      ă: 'a',
      ằ: 'a',
      ắ: 'a',
      ẳ: 'a',
      ẵ: 'a',
      ặ: 'a',
      â: 'a',
      ầ: 'a',
      ấ: 'a',
      ẩ: 'a',
      ẫ: 'a',
      ậ: 'a',
      è: 'e',
      é: 'e',
      ẻ: 'e',
      ẽ: 'e',
      ẹ: 'e',
      ê: 'e',
      ề: 'e',
      ế: 'e',
      ể: 'e',
      ễ: 'e',
      ệ: 'e',
      ì: 'i',
      í: 'i',
      ỉ: 'i',
      ĩ: 'i',
      ị: 'i',
      ò: 'o',
      ó: 'o',
      ỏ: 'o',
      õ: 'o',
      ọ: 'o',
      ô: 'o',
      ồ: 'o',
      ố: 'o',
      ổ: 'o',
      ỗ: 'o',
      ộ: 'o',
      ơ: 'o',
      ờ: 'o',
      ớ: 'o',
      ở: 'o',
      ỡ: 'o',
      ợ: 'o',
      ù: 'u',
      ú: 'u',
      ủ: 'u',
      ũ: 'u',
      ụ: 'u',
      ư: 'u',
      ừ: 'u',
      ứ: 'u',
      ử: 'u',
      ữ: 'u',
      ự: 'u',
      ỳ: 'y',
      ý: 'y',
      ỷ: 'y',
      ỹ: 'y',
      ỵ: 'y',
      đ: 'd',
      À: 'A',
      Á: 'A',
      Ả: 'A',
      Ã: 'A',
      Ạ: 'A',
      Ă: 'A',
      Ằ: 'A',
      Ắ: 'A',
      Ẳ: 'A',
      Ẵ: 'A',
      Ặ: 'A',
      Â: 'A',
      Ầ: 'A',
      Ấ: 'A',
      Ẩ: 'A',
      Ẫ: 'A',
      Ậ: 'A',
      È: 'E',
      É: 'E',
      Ẻ: 'E',
      Ẽ: 'E',
      Ẹ: 'E',
      Ê: 'E',
      Ề: 'E',
      Ế: 'E',
      Ể: 'E',
      Ễ: 'E',
      Ệ: 'E',
      Ì: 'I',
      Í: 'I',
      Ỉ: 'I',
      Ĩ: 'I',
      Ị: 'I',
      Ò: 'O',
      Ó: 'O',
      Ỏ: 'O',
      Õ: 'O',
      Ọ: 'O',
      Ô: 'O',
      Ồ: 'O',
      Ố: 'O',
      Ổ: 'O',
      Ỗ: 'O',
      Ộ: 'O',
      Ơ: 'O',
      Ờ: 'O',
      Ớ: 'O',
      Ở: 'O',
      Ỡ: 'O',
      Ợ: 'O',
      Ù: 'U',
      Ú: 'U',
      Ủ: 'U',
      Ũ: 'U',
      Ụ: 'U',
      Ư: 'U',
      Ừ: 'U',
      Ứ: 'U',
      Ử: 'U',
      Ữ: 'U',
      Ự: 'U',
      Ỳ: 'Y',
      Ý: 'Y',
      Ỷ: 'Y',
      Ỹ: 'Y',
      Ỵ: 'Y',
      Đ: 'D',
    };
    return text.replace(
      /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/g,
      (ch) => accentMap[ch] || ch,
    );
  }

  /**
   * Validate search keyword (T010, CR-003, BR-013, BR-021).
   * Trim whitespace, check max length 255.
   * Returns null neu empty (view mode) hoac keyword da trim.
   * Throws BadRequestException neu > 255.
   */
  private validateSearchKeyword(q: string): {
    keyword: string | null;
    error: any;
  } {
    const trimmed = q.trim();
    if (trimmed.length === 0) {
      return { keyword: null, error: null }; // view mode
    }
    if (trimmed.length > 255) {
      return {
        keyword: null,
        error: {
          success: false,
          message: 'Tu khoa tim kiem khong duoc vuot qua 255 ky tu',
          error: { code: 'VALIDATION_ERROR', details: { maxLength: 255 } },
        },
      };
    }
    return { keyword: trimmed, error: null };
  }

  /**
   * Build OR visibility predicate cho Participant path (T008).
   * Ap dung len QueryBuilder cho meeting_notes (alias 'mn').
   * currentUserDeptId nullable - neu NULL thi skip department predicate.
   */
  private buildParticipantVisibilityPredicate(
    qb: any,
    alias: string,
    currentUserId: string,
    currentUserDeptId: string | null,
  ): void {
    const conditions: string[] = [
      alias + '.authorId = :currentUserId',
      alias + ".visibilityLevel = 'participants'",
      alias + ".visibilityLevel = 'public_internal'",
    ];
    const params: Record<string, any> = { currentUserId };

    if (currentUserDeptId) {
      conditions.push(
        '(' +
          alias +
          ".visibilityLevel = 'department' AND EXISTS (SELECT 1 FROM users u2 WHERE u2.id = " +
          alias +
          '.authorId AND u2.department_id IS NOT NULL AND u2.department_id = :currentUserDeptId))',
      );
      params.currentUserDeptId = currentUserDeptId;
    }

    qb.andWhere('(' + conditions.join(' OR ') + ')', params);
  }

  /**
   * Ap optional filter params len QueryBuilder (T012).
   * noteType, visibility, pinned, from, to.
   * Ap dung SAU visibility predicate (BR-015).
   */
  private applyOptionalFilters(
    qb: any,
    alias: string,
    query: {
      noteType?: string;
      visibility?: string;
      pinned?: boolean;
      from?: string;
      to?: string;
      authorId?: string;
      createdFrom?: string;
      createdTo?: string;
    },
  ): void {
    if (query.noteType) {
      qb.andWhere(alias + '.noteType = :noteType', {
        noteType: query.noteType,
      });
    }
    if (query.visibility) {
      qb.andWhere(alias + '.visibilityLevel = :visibility', {
        visibility: query.visibility,
      });
    }
    if (query.pinned !== undefined) {
      qb.andWhere(alias + '.pinned = :pinned', { pinned: query.pinned });
    }
    if (query.from) {
      qb.andWhere(alias + '.createdAt >= :from', {
        from: new Date(query.from),
      });
    }
    if (query.to) {
      qb.andWhere(alias + '.createdAt <= :to', { to: new Date(query.to) });
    }
    // UC-IMM-11 search filters
    if (query.authorId) {
      qb.andWhere(alias + '.authorId = :authorId', {
        authorId: query.authorId,
      });
    }
    if (query.createdFrom) {
      qb.andWhere(alias + '.createdAt >= :createdFrom', {
        createdFrom: new Date(query.createdFrom),
      });
    }
    if (query.createdTo) {
      qb.andWhere(alias + '.createdAt <= :createdTo', {
        createdTo: new Date(query.createdTo),
      });
    }
  }

  // ------------------------------------------------------------------
  //  UC-IMM-10: View Meeting Notes (Core Method - T009)
  // ------------------------------------------------------------------

  /**
   * Xem danh sach ghi chu cua cuoc hop (UC-IMM-10).
   * Read-only: khong transaction, khong side effect (BR-011, FR-020).
   */
  async viewMeetingNotes(
    meetingId: string,
    query: any,
    authUser: AuthUser,
  ): Promise<{
    data: any[];
    meta: { page: number; limit: number; total: number; totalPages: number };
    message: string;
  }> {
    const { MeetingNoteEntity } =
      await import('../../meetings/entities/meeting-note.entity.js');
    const { MeetingEntity } =
      await import('../../meetings/entities/meeting.entity.js');
    const { UserEntity } =
      await import('../../accounts/entities/user.entity.js');
    const { MeetingParticipantEntity } =
      await import('../../meetings/entities/meeting-participant.entity.js');
    const { MeetingEventEntity } =
      await import('../../meetings/entities/meeting-event.entity.js');
    const { MEETING_NOTE_ERRORS } =
      await import('../constants/meeting-note-error.constant.js');
    const { ViewNoteResponseDto } =
      await import('../dto/view-note-response.dto.js');
    const {
      BadRequestException,
      NotFoundException,
      ForbiddenException,
      UnprocessableEntityException,
    } = await import('@nestjs/common');

    const currentUserId = authUser.userId;

    // -- Step 1: Cross-field from/to validation (T013, CD-003) --
    if (query.from && query.to) {
      const fromDate = new Date(query.from);
      const toDate = new Date(query.to);
      if (fromDate > toDate) {
        throw new BadRequestException({
          success: false,
          message: "Gia tri 'from' phai nho hon hoac bang 'to'",
          error: {
            code: MEETING_NOTE_ERRORS.INVALID_DATE_RANGE,
            details: { from: query.from, to: query.to },
          },
        });
      }
    }

    // -- Step 1b: Search keyword validation (UC-IMM-11, FR-007, BR-021, CR-003) --
    if (query.q) {
      const qValidation = this.validateSearchKeyword(query.q);
      if (qValidation.error) {
        const { BadRequestException } = await import('@nestjs/common');
        throw new BadRequestException(qValidation.error);
      }
    }

    // -- Step 2: Validate meeting ton tai + status (FR-004, FR-005) --
    const meetingRepo = this.dataSource.getRepository(MeetingEntity);
    const meeting = await meetingRepo.findOne({
      where: { id: meetingId },
      select: { id: true, status: true, hostId: true, deletedAt: true },
    });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay cuoc hop',
        error: {
          code: MEETING_NOTE_ERRORS.MEETING_NOT_FOUND,
          details: { meetingId },
        },
      });
    }

    const validStatuses = ['in_progress', 'completed'];
    if (!validStatuses.includes(meeting.status)) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Cuoc hop khong o trang thai cho phep xem ghi chu',
        error: {
          code: MEETING_NOTE_ERRORS.MEETING_STATUS_NOT_VIEWABLE,
          details: { currentStatus: meeting.status },
        },
      });
    }

    // -- Step 3: Lay currentUserDeptId --
    const userRepo = this.dataSource.getRepository(UserEntity);
    const currentUser = await userRepo.findOne({
      where: { id: currentUserId },
      select: { id: true, departmentId: true },
    });
    const currentUserDeptId: string | null = currentUser?.departmentId || null;

    // -- Step 4: Membership check (FR-006, BR-002, CD-002) --
    const participantRepo = this.dataSource.getRepository(
      MeetingParticipantEntity,
    );
    const participant = await participantRepo.findOne({
      where: { meetingId, userId: currentUserId },
      select: { participantRole: true },
    });

    const { isHost, isCoHost, isParticipant } = this.resolveMeetingRole(
      meeting,
      participant,
      currentUserId,
    );

    if (!isHost && !isCoHost && !isParticipant) {
      throw new ForbiddenException({
        success: false,
        message: 'Ban khong co quyen xem ghi chu cua cuoc hop nay.',
        error: {
          code: MEETING_NOTE_ERRORS.NOT_A_MEETING_PARTICIPANT,
          details: {},
        },
      });
    }

    // -- Step 5: Build QueryBuilder --
    const noteRepo = this.dataSource.getRepository(MeetingNoteEntity);
    const qb = noteRepo
      .createQueryBuilder('mn')
      .leftJoinAndSelect('mn.author', 'u')
      .where('mn.meetingId = :meetingId', { meetingId })
      .andWhere('mn.deletedAt IS NULL'); // BR-003, FR-009

    // -- Step 6: Visibility predicate --
    if (isHost) {
      // Host: khong them visibility predicate (FR-007, BR-004)
    } else if (isCoHost) {
      // Co-host: thay tat ca notes NGOAI TRU private notes cua user khac (BR-020, CR-002)
      qb.andWhere(
        '(mn.authorId = :currentUserId OR mn.visibilityLevel != :privateVisibility OR mn.visibilityLevel IS NULL)',
        { currentUserId, privateVisibility: 'private' },
      );
      qb.andWhere(
        "(mn.visibilityLevel = 'private' AND mn.authorId = :coHostUserId) OR mn.visibilityLevel != 'private' OR mn.visibilityLevel IS NULL",
        { coHostUserId: currentUserId },
      );
    } else {
      // Participant: ap dung buildParticipantVisibilityPredicate (FR-008, BR-005)
      this.buildParticipantVisibilityPredicate(
        qb,
        'mn',
        currentUserId,
        currentUserDeptId,
      );
    }

    // -- Step 6b: Search predicate (UC-IMM-11, FR-007, FR-011, BR-016) --
    // Search duoc ap dung SAU visibility filter (FR-011)
    if (query.q) {
      const qResult = this.validateSearchKeyword(query.q);
      if (qResult.error) {
        const { BadRequestException } = await import('@nestjs/common');
        throw new BadRequestException(qResult.error);
      }
      const searchKeyword = qResult.keyword;
      if (searchKeyword !== null) {
        // Preferred: PostgreSQL FTS (GIN index)
        qb.andWhere(
          "to_tsvector('simple', mn.content) @@ plainto_tsquery('simple', :searchQ)",
          {
            searchQ: searchKeyword,
          },
        );
      }
      // Fallback ILIKE: neu FTS khong tra ket qua, co the them ILIKE o day
      // (FR-028, CR-004) - ghi chu: ILIKE can escape wildcard
    }

    // -- Step 7: Optional filters (T012) --
    this.applyOptionalFilters(qb, 'mn', query);

    // -- Step 8: Opt-in enrichment includeSourceEvent (T016, CD-001) --
    const includeSourceEvent = query.includeSourceEvent === true;
    if (includeSourceEvent) {
      qb.leftJoinAndMapOne(
        'mn.sourceEvent',
        MeetingEventEntity,
        'me',
        'mn.sourceEventId = me.id',
      ).addSelect(['me.eventTime', 'me.eventType']);
    }

    // -- Step 9: Sort (T014, BR-007, BR-008) --
    const sortDir = query.sort === 'timeline_desc' ? 'DESC' : 'ASC';
    qb.orderBy('mn.createdAt', sortDir);

    // -- Step 10: Pagination (T015) --
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // Count query with same visibility + filters + search
    const countQb = noteRepo
      .createQueryBuilder('mn')
      .where('mn.meetingId = :meetingId', { meetingId })
      .andWhere('mn.deletedAt IS NULL');

    if (isHost) {
      // Host: khong them visibility predicate
    } else if (isCoHost) {
      countQb.andWhere(
        '(mn.authorId = :currentUserId OR mn.visibilityLevel != :privateVisibility OR mn.visibilityLevel IS NULL)',
        { currentUserId, privateVisibility: 'private' },
      );
    } else {
      this.buildParticipantVisibilityPredicate(
        countQb,
        'mn',
        currentUserId,
        currentUserDeptId,
      );
    }

    // Add search predicate to count query (if search mode)
    if (query.q) {
      const qResult = this.validateSearchKeyword(query.q);
      if (qResult.error) {
        const { BadRequestException } = await import('@nestjs/common');
        throw new BadRequestException(qResult.error);
      }
      const searchKeyword = qResult.keyword;
      if (searchKeyword !== null) {
        countQb.andWhere(
          "to_tsvector('simple', mn.content) @@ plainto_tsquery('simple', :searchQ)",
          {
            searchQ: searchKeyword,
          },
        );
      }
    }

    this.applyOptionalFilters(countQb, 'mn', query);

    const total = await countQb.getCount();

    qb.skip(skip).take(limit);
    const notes = await qb.getMany();

    // -- Step 11: Map -> ViewNoteResponseDto[] --
    const data = notes.map((note: any) => {
      const author = note.author;
      const dtoData: any = {
        id: note.id,
        meetingId: note.meetingId,
        noteType: note.noteType,
        content: note.content,
        pinned: note.pinned,
        visibilityLevel: note.visibilityLevel,
        author: {
          id: author?.id || '',
          fullName: author?.fullName || '',
        },
        sourceEventId: note.sourceEventId || null,
        noteTimestamp: note.createdAt?.toISOString() || '', // CD-001
        updatedAt: note.updatedAt?.toISOString() || '',
      };

      if (includeSourceEvent) {
        const sourceEvent = note.sourceEvent;
        dtoData.sourceEventTime = sourceEvent?.eventTime?.toISOString() ?? null;
        dtoData.sourceEventType = sourceEvent?.eventType ?? null;
      }

      return new ViewNoteResponseDto(dtoData);
    });

    const totalPages = Math.ceil(total / limit);

    // Empty state (FR-018, BR-012)
    const isSearchMode = query.q && query.q.trim().length > 0;
    const message =
      total === 0
        ? isSearchMode
          ? 'Khong tim thay ghi chu nao khop voi dieu kien tim kiem cua ban.'
          : 'Cuoc hop nay khong co ghi chu nao duoc luu lai.'
        : isSearchMode
          ? 'Tim kiem ghi chu thanh cong'
          : 'Lay danh sach ghi chu thanh cong';

    return { data, meta: { page, limit, total, totalPages }, message };
  }

  /**
   * Doc config meeting_warning_before_minutes tu system_configs.
   * Fallback DEFAULT_WARNING_MINUTES = 10 neu key khong ton tai hoac parse loi.
   * Covers FR-01, FR-14, ERR-01, ERR-02.
   */
  private async readWarningConfig(): Promise<number> {
    try {
      const config = await this.dataSource
        .getRepository(SystemConfigEntity)
        .findOne({
          where: { configKey: 'meeting_warning_before_minutes' },
        });
      if (!config) {
        this.logger.warn(
          '[readWarningConfig] Config key meeting_warning_before_minutes not found, using default ' +
            this.DEFAULT_WARNING_MINUTES,
        );
        return this.DEFAULT_WARNING_MINUTES;
      }
      const parsed = parseInt(config.configValue || '10', 10);
      if (isNaN(parsed) || parsed <= 0) {
        this.logger.error(
          '[readWarningConfig] Invalid config value: ' +
            config.configValue +
            ', using default ' +
            this.DEFAULT_WARNING_MINUTES,
        );
        return this.DEFAULT_WARNING_MINUTES;
      }
      return parsed;
    } catch (error: unknown) {
      this.logger.error(
        '[readWarningConfig] Error reading config: ' + (error as Error).message,
      );
      return this.DEFAULT_WARNING_MINUTES;
    }
  }

  /**
   * Schedule warning job for a meeting that is in_progress.
   * Normal Flow + AF2 + skip guard.
   * Non-blocking: catches all errors, returns result without throwing.
   * Covers FR-01 to FR-05, FR-10, FR-12, FR-14, FR-15, FR-17, FR-18, FR-21.
   */
  async scheduleWarningJob(meetingId: string): Promise<ScheduleWarningResult> {
    try {
      // 1. Guard check: load meeting
      const meeting = await this.dataSource
        .getRepository(MeetingEntity)
        .findOne({
          where: { id: meetingId },
          select: { id: true, status: true, endTime: true },
        });
      if (!meeting || meeting.deletedAt) {
        this.logger.error(
          '[' +
            this.SCHEDULER_JOB_NAME +
            '] ' +
            MEETING_WARNING_ERRORS.MEETING_NOT_FOUND_FOR_SCHEDULING +
            ' meetingId=' +
            meetingId,
        );
        return { skipped: true, reason: 'guard_failed' };
      }
      if (meeting.status !== 'in_progress') {
        this.logger.warn(
          '[' +
            this.SCHEDULER_JOB_NAME +
            '] ' +
            MEETING_WARNING_ERRORS.MEETING_NOT_IN_PROGRESS_FOR_SCHEDULING +
            ' meetingId=' +
            meetingId +
            ' status=' +
            meeting.status,
        );
        return { skipped: true, reason: 'guard_failed' };
      }
      if (!meeting.endTime) {
        this.logger.warn(
          '[' +
            this.SCHEDULER_JOB_NAME +
            '] ' +
            MEETING_WARNING_ERRORS.MEETING_END_TIME_NULL +
            ' meetingId=' +
            meetingId,
        );
        return { skipped: true, reason: 'guard_failed' };
      }

      // 2. Read config
      const configMinutes = await this.readWarningConfig();
      const endTime = meeting.endTime;
      const now = new Date();

      // 3. Calculate warningScheduledAt
      let warningScheduledAt = new Date(
        endTime.getTime() - configMinutes * 60000,
      );
      let adjustedWarning = false;

      // 4. AF2 check: remainingMinutes <= configMinutes
      const remainingMinutes = (endTime.getTime() - now.getTime()) / 60000;
      if (remainingMinutes <= configMinutes) {
        const adjustedMinutes = Math.floor(remainingMinutes / 2);
        warningScheduledAt = new Date(now.getTime() + adjustedMinutes * 60000);
        adjustedWarning = true;
        this.logger.warn(
          '[' +
            this.SCHEDULER_JOB_NAME +
            '] AF2 triggered' +
            ' meetingId=' +
            meetingId +
            ' originalConfigMinutes=' +
            configMinutes +
            ' remainingMinutes=' +
            remainingMinutes.toFixed(1) +
            ' usedMinutes=' +
            adjustedMinutes,
        );
      }

      // 5. Skip guard
      if (warningScheduledAt.getTime() <= now.getTime() + 60000) {
        // Log skip event
        try {
          const skipEvent = this.dataSource
            .getRepository(MeetingEventEntity)
            .create({
              meetingId,
              eventType: MeetingEventType.WARNING_SCHEDULING_SKIPPED,
              eventTime: now,
              actorUserId: null,
              sourceType: MeetingEventSourceType.SCHEDULER,
              description: 'Warning scheduling skipped (time too close)',
              newValueJson: {
                warningScheduledAt: warningScheduledAt.toISOString(),
                reason: 'too_close_to_now',
              } as Record<string, unknown>,
              metadataJson: {
                configMinutes,
                remainingSeconds: Math.round(
                  (warningScheduledAt.getTime() - now.getTime()) / 1000,
                ),
              } as Record<string, unknown>,
            });
          await this.dataSource
            .getRepository(MeetingEventEntity)
            .save(skipEvent);
        } catch (eventErr: unknown) {
          this.logger.error(
            '[' +
              this.SCHEDULER_JOB_NAME +
              '] Failed to save skip event: ' +
              (eventErr as Error).message,
          );
        }
        this.logger.warn(
          '[' +
            this.SCHEDULER_JOB_NAME +
            '] ' +
            MEETING_WARNING_ERRORS.WARNING_SCHEDULING_SKIPPED +
            ' meetingId=' +
            meetingId +
            ' warningScheduledAt=' +
            warningScheduledAt.toISOString(),
        );
        return { skipped: true, reason: 'too_close', warningScheduledAt };
      }

      // 6. Enqueue BullMQ job
      const delayMs = warningScheduledAt.getTime() - now.getTime();
      const jobId = 'meeting-time-warning:' + meetingId;
      let enqueuedJobId: string | undefined;
      try {
        enqueuedJobId = await this.queueService.addJob(
          this.schedulerQueueName,
          'meeting-time-warning',
          {
            meetingId,
            warningScheduledAt: warningScheduledAt.toISOString(),
            endTime: endTime.toISOString(),
          },
          {
            jobId,
            delay: delayMs,
          },
        );
      } catch (enqueueErr: unknown) {
        const errMsg = (enqueueErr as Error).message || '';
        if (
          errMsg.includes('already exists') ||
          errMsg.includes('deduplicate')
        ) {
          this.logger.log(
            '[' +
              this.SCHEDULER_JOB_NAME +
              '] Idempotent: job already exists for meetingId=' +
              meetingId,
          );
          // Idempotent - continue to return success
        } else {
          this.logger.error(
            '[' +
              this.SCHEDULER_JOB_NAME +
              '] ' +
              MEETING_WARNING_ERRORS.WARNING_ENQUEUE_FAILED +
              ' meetingId=' +
              meetingId +
              ' error=' +
              errMsg,
          );
          return { skipped: true, reason: 'error' };
        }
      }

      // 7. Upsert background_jobs
      try {
        const bgRepo = this.dataSource.getRepository(BackgroundJobEntity);
        const existing = await bgRepo.findOne({
          where: {
            relatedEntityId: meetingId,
            jobType: BackgroundJobType.MEETING_TIME_WARNING,
          },
        });
        const inputJson = {
          meetingId,
          endTime: endTime.toISOString(),
          warningScheduledAt: warningScheduledAt.toISOString(),
          adjustedWarningMinutes: adjustedWarning
            ? Math.floor(remainingMinutes / 2)
            : undefined,
        };
        if (existing) {
          await bgRepo.update(existing.id, {
            status: BackgroundJobStatus.SCHEDULED,
            scheduledAt: warningScheduledAt,
            inputJson: inputJson,
          });
        } else {
          const bg = bgRepo.create({
            jobType: BackgroundJobType.MEETING_TIME_WARNING,
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            queueName: this.schedulerQueueName,
            status: BackgroundJobStatus.SCHEDULED,
            scheduledAt: warningScheduledAt,
            inputJson: inputJson as Record<string, unknown>,
          });
          await bgRepo.save(bg);
        }
      } catch (bgErr: unknown) {
        this.logger.error(
          '[' +
            this.SCHEDULER_JOB_NAME +
            '] background_jobs upsert failed: ' +
            (bgErr as Error).message,
        );
        // Best-effort: continue
      }

      // 8. Save meeting_events: warning_scheduled
      try {
        const eventData: Record<string, unknown> = {
          warningScheduledAt: warningScheduledAt.toISOString(),
          jobId: enqueuedJobId || jobId,
          adjustedWarning,
        };
        if (adjustedWarning) {
          eventData.remainingMinutes = remainingMinutes;
        }
        const event = this.dataSource.getRepository(MeetingEventEntity).create({
          meetingId,
          eventType: MeetingEventType.WARNING_SCHEDULED,
          eventTime: now,
          actorUserId: null,
          sourceType: MeetingEventSourceType.SCHEDULER,
          description: 'Warning job scheduled',
          newValueJson: eventData,
          metadataJson: { configMinutes, remainingMinutes } as Record<
            string,
            unknown
          >,
        });
        await this.dataSource.getRepository(MeetingEventEntity).save(event);
      } catch (eventErr: unknown) {
        this.logger.error(
          '[' +
            this.SCHEDULER_JOB_NAME +
            '] Failed to save warning_scheduled event: ' +
            (eventErr as Error).message,
        );
        // Best-effort: continue
      }

      // 9. Log
      this.logger.log(
        '[' +
          this.SCHEDULER_JOB_NAME +
          '] Scheduled' +
          ' meetingId=' +
          meetingId +
          ' warningScheduledAt=' +
          warningScheduledAt.toISOString() +
          ' jobId=' +
          jobId +
          ' adjustedWarning=' +
          adjustedWarning,
      );

      return { skipped: false, warningScheduledAt };
    } catch (error: unknown) {
      this.logger.error(
        '[' +
          this.SCHEDULER_JOB_NAME +
          '] Unexpected error: ' +
          (error as Error).message,
      );
      return { skipped: true, reason: 'error' };
    }
  }

  /**
   * Reschedule warning job when meeting is extended (AF1).
   * Cancel old job, re-calculate, re-enqueue.
   * Non-blocking: catches all errors.
   * Covers FR-07, FR-11, FR-16, FR-20, FR-23.
   */
  async rescheduleWarningJob(
    meetingId: string,
  ): Promise<ScheduleWarningResult> {
    try {
      // 1. Guard check
      const meeting = await this.dataSource
        .getRepository(MeetingEntity)
        .findOne({
          where: { id: meetingId },
          select: { id: true, status: true, endTime: true },
        });
      if (!meeting || meeting.deletedAt) {
        this.logger.error(
          '[' +
            this.SCHEDULER_JOB_NAME +
            '] ' +
            MEETING_WARNING_ERRORS.MEETING_NOT_FOUND_FOR_SCHEDULING +
            ' meetingId=' +
            meetingId,
        );
        return { skipped: true, reason: 'guard_failed' };
      }
      if (meeting.status !== 'in_progress') {
        this.logger.warn(
          '[' +
            this.SCHEDULER_JOB_NAME +
            '] ' +
            MEETING_WARNING_ERRORS.MEETING_NOT_IN_PROGRESS_FOR_SCHEDULING +
            ' meetingId=' +
            meetingId,
        );
        return { skipped: true, reason: 'guard_failed' };
      }
      if (!meeting.endTime) {
        this.logger.warn(
          '[' +
            this.SCHEDULER_JOB_NAME +
            '] ' +
            MEETING_WARNING_ERRORS.MEETING_END_TIME_NULL +
            ' meetingId=' +
            meetingId,
        );
        return { skipped: true, reason: 'guard_failed' };
      }

      // 2. Cancel old BullMQ job
      try {
        const queue = this.queueService.getQueue(this.schedulerQueueName);
        if (queue) {
          const oldJobId = 'meeting-time-warning:' + meetingId;
          const oldJob = await queue.getJob(oldJobId);
          if (oldJob) {
            await oldJob.remove();
            this.logger.log(
              '[' +
                this.SCHEDULER_JOB_NAME +
                '] Cancelled old job for meetingId=' +
                meetingId,
            );
          } else {
            this.logger.log(
              '[' +
                this.SCHEDULER_JOB_NAME +
                '] Old job not found for meetingId=' +
                meetingId +
                ' (idempotent cancel)',
            );
          }
        } else {
          this.logger.error(
            '[' +
              this.SCHEDULER_JOB_NAME +
              '] Queue not found: ' +
              this.schedulerQueueName,
          );
          return { skipped: true, reason: 'error' };
        }
      } catch (cancelErr: unknown) {
        this.logger.error(
          '[' +
            this.SCHEDULER_JOB_NAME +
            '] Cancel old job failed: ' +
            (cancelErr as Error).message,
        );
        // Continue to re-enqueue
      }

      // 3. Re-calculate and re-enqueue (reuse scheduleWarningJob logic)
      return this.scheduleWarningJob(meetingId);
    } catch (error: unknown) {
      this.logger.error(
        '[' +
          this.SCHEDULER_JOB_NAME +
          '] rescheduleWarningJob unexpected error: ' +
          (error as Error).message,
      );
      return { skipped: true, reason: 'error' };
    }
  }

  /**
   * Cancel warning job when meeting ends (AF3).
   * Remove BullMQ job + update background_jobs status.
   * Does NOT create meeting_events (FR-13).
   * Non-blocking: catches all errors.
   * Covers FR-08, FR-13, FR-22.
   */
  async cancelWarningJob(meetingId: string): Promise<void> {
    try {
      // 1. Cancel BullMQ job
      const jobId = 'meeting-time-warning:' + meetingId;
      try {
        const queue = this.queueService.getQueue(this.schedulerQueueName);
        if (queue) {
          const job = await queue.getJob(jobId);
          if (job) {
            await job.remove();
            this.logger.log(
              '[' +
                this.SCHEDULER_JOB_NAME +
                '] Cancelled warning job for meetingId=' +
                meetingId,
            );
          } else {
            this.logger.log(
              '[' +
                this.SCHEDULER_JOB_NAME +
                '] Warning job not found for meetingId=' +
                meetingId +
                ' (already fired or never scheduled)',
            );
          }
        } else {
          this.logger.error(
            '[' +
              this.SCHEDULER_JOB_NAME +
              '] Queue not found: ' +
              this.schedulerQueueName,
          );
        }
      } catch (removeErr: unknown) {
        this.logger.error(
          '[' +
            this.SCHEDULER_JOB_NAME +
            '] ' +
            MEETING_WARNING_ERRORS.WARNING_CANCEL_FAILED +
            ' meetingId=' +
            meetingId +
            ' error=' +
            (removeErr as Error).message,
        );
      }

      // 2. Update background_jobs to CANCELLED
      try {
        const bgRepo = this.dataSource.getRepository(BackgroundJobEntity);
        const existing = await bgRepo.findOne({
          where: {
            relatedEntityId: meetingId,
            jobType: BackgroundJobType.MEETING_TIME_WARNING,
          },
        });
        if (existing) {
          await bgRepo.update(existing.id, {
            status: BackgroundJobStatus.CANCELLED,
          });
          this.logger.log(
            '[' +
              this.SCHEDULER_JOB_NAME +
              '] Updated background_job ' +
              existing.id +
              ' to CANCELLED',
          );
        }
      } catch (bgErr: unknown) {
        this.logger.error(
          '[' +
            this.SCHEDULER_JOB_NAME +
            '] background_jobs cancel update failed: ' +
            (bgErr as Error).message,
        );
        // Non-blocking
      }

      // 3. NO meeting_events (FR-13)
    } catch (error: unknown) {
      this.logger.error(
        '[' +
          this.SCHEDULER_JOB_NAME +
          '] ' +
          MEETING_WARNING_ERRORS.WARNING_CANCEL_FAILED +
          ' error=' +
          (error as Error).message,
      );
    }
  }
}
