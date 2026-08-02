import { UserEntity } from '../../accounts/entities/user.entity.js';
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, In, LessThanOrEqual, MoreThanOrEqual, Not } from 'typeorm';

import { MeetingEntity, MeetingStatus } from '../entities/meeting.entity.js';
import {
  MeetingRequestEntity,
  MeetingRequestType,
  ApprovalStatus,
  ConflictCheckStatus,
} from '../entities/meeting-request.entity.js';
import { MeetingParticipantEntity } from '../entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../entities/meeting-external-participant.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../entities/meeting-event.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
} from '../../rooms/entities/room-booking.entity.js';
import { RoomEventEntity } from '../../rooms/entities/room-event.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';

import { NotificationsService } from '../../notifications/notifications.service.js';

import { ApproveMeetingRequestDto } from '../dto/approve-meeting-request.dto.js';
import { RejectMeetingRequestDto } from '../dto/reject-meeting-request.dto.js';
import { ApproveResponseDto } from '../dto/approve-response.dto.js';
import { RejectResponseDto } from '../dto/reject-response.dto.js';

import type { AuthUser, ClientContext } from './meetings.service.js';

const SUPPORTED_REQUEST_TYPES = [
  MeetingRequestType.CREATE_MEETING,
  MeetingRequestType.UPDATE_TIME,
  MeetingRequestType.UPDATE_ROOM,
];

interface MeetingApprovalResult {
  meetingId: string;
  meetingTitle: string;
  meetingStartTime: Date;
  meetingEndTime: Date;
  requestType: MeetingRequestType;
  bookingId: string;
  appliedAt: Date;
  participantIds: string[];
  externalEmails: string[];
  requesterId: string;
  hostId: string | null;
  decisionNote: string | null;
  oldRoomName: string | null;
  newRoomName: string | null;
}

@Injectable()
export class MeetingRequestReviewService {
  private readonly logger = new Logger(MeetingRequestReviewService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  async approve(
    requestId: string,
    dto: ApproveMeetingRequestDto,
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<ApproveResponseDto> {
    const approvalResult = await this.dataSource.transaction(async (em) => {
      const request = await em.findOne(MeetingRequestEntity, {
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!request) {
        throw new NotFoundException({
          success: false,
          message: 'Không tìm thấy yêu cầu cuộc họp',
          error: {
            code: 'RESOURCE_NOT_FOUND',
            details: { entityType: 'meeting_request', entityId: requestId },
          },
        });
      }

      if (!SUPPORTED_REQUEST_TYPES.includes(request.requestType)) {
        throw new UnprocessableEntityException({
          success: false,
          message: 'Loại yêu cầu không được hỗ trợ',
          error: {
            code: 'UNSUPPORTED_REQUEST_TYPE',
            details: {
              requestType: request.requestType,
              supportedTypes: SUPPORTED_REQUEST_TYPES,
            },
          },
        });
      }

      const isUpdateRequest =
        request.requestType === MeetingRequestType.UPDATE_TIME ||
        request.requestType === MeetingRequestType.UPDATE_ROOM;

      if (request.approvalStatus !== ApprovalStatus.PENDING) {
        throw new ConflictException({
          success: false,
          message: 'Yêu cầu cuộc họp không còn trạng thái chờ duyệt',
          error: {
            code: 'INVALID_STATE',
            details: {
              currentStatus: request.approvalStatus,
              expectedStatus: ApprovalStatus.PENDING,
            },
          },
        });
      }

      const meeting = await em.findOne(MeetingEntity, {
        where: { id: request.meetingId! },
      });

      if (!meeting) {
        throw new NotFoundException({
          success: false,
          message: 'Không tìm thấy cuộc họp liên quan',
          error: {
            code: 'RESOURCE_NOT_FOUND',
            details: { entityType: 'meeting', entityId: request.meetingId },
          },
        });
      }

      if (meeting.status !== MeetingStatus.PENDING_APPROVAL) {
        throw new ConflictException({
          success: false,
          message: 'Cuộc họp không còn trạng thái chờ phê duyệt',
          error: {
            code: 'INVALID_STATE',
            details: {
              currentStatus: meeting.status,
              expectedStatus: MeetingStatus.PENDING_APPROVAL,
            },
          },
        });
      }

      // Loại RELEASED/CANCELLED — 1 meeting có thể có nhiều dòng booking lịch
      // sử (vd đổi phòng khi còn PENDING_APPROVAL tạo booking mới, release
      // booking cũ). orderBy createdAt DESC để lấy booking đang hiệu lực gần
      // nhất nếu có nhiều hơn 1 dòng active (không nên xảy ra, phòng thủ).
      const booking = await em.findOne(RoomBookingEntity, {
        where: {
          meetingId: meeting.id,
          status: In([
            RoomBookingStatus.PENDING,
            RoomBookingStatus.APPROVED,
            RoomBookingStatus.ACTIVE,
          ]),
        },
        order: { createdAt: 'DESC' },
      });

      if (!booking) {
        throw new NotFoundException({
          success: false,
          message: 'Không tìm thấy booking phòng họp liên quan',
          error: {
            code: 'RESOURCE_NOT_FOUND',
            details: { entityType: 'room_booking', entityId: meeting.id },
          },
        });
      }

      // CREATE_MEETING: booking chưa từng được duyệt → phải PENDING.
      // UPDATE_TIME/UPDATE_ROOM: booking đang giữ slot CŨ của 1 meeting đã
      // SCHEDULED → phải APPROVED/ACTIVE (KHÔNG phải PENDING).
      const expectedBookingStatuses = isUpdateRequest
        ? [RoomBookingStatus.APPROVED, RoomBookingStatus.ACTIVE]
        : [RoomBookingStatus.PENDING];
      if (!expectedBookingStatuses.includes(booking.status)) {
        throw new ConflictException({
          success: false,
          message: 'Booking phòng họp không còn ở trạng thái hợp lệ để duyệt',
          error: {
            code: 'INVALID_STATE',
            details: {
              currentStatus: booking.status,
              expectedStatus: expectedBookingStatuses,
            },
          },
        });
      }

      if (
        request.requestedBy === authUser.userId ||
        meeting.organizerId === authUser.userId
      ) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không thể tự duyệt yêu cầu cuộc họp do chính mình tạo',
          error: { code: 'SELF_APPROVAL_NOT_ALLOWED' },
        });
      }

      // Slot đích: với CREATE_MEETING, target === slot hiện tại của booking
      // (no-op). Với UPDATE_TIME/UPDATE_ROOM, target là giá trị yêu cầu mới —
      // PHẢI kiểm xung đột lại tại đây vì slot có thể đã bị chiếm giữa lúc
      // gửi yêu cầu và lúc duyệt.
      const targetRoomId = request.targetRoomId || meeting.roomId!;
      const targetStartTime = request.requestedStartTime || meeting.startTime;
      const targetEndTime = request.requestedEndTime || meeting.endTime;

      const conflicts = await em.getRepository(RoomBookingEntity).find({
        where: {
          roomId: targetRoomId,
          id: Not(booking.id),
          status: In([
            RoomBookingStatus.PENDING,
            RoomBookingStatus.APPROVED,
            RoomBookingStatus.ACTIVE,
          ]),
          reservedStartTime: LessThanOrEqual(targetEndTime),
          reservedEndTime: MoreThanOrEqual(targetStartTime),
        },
      });

      if (conflicts.length > 0) {
        request.conflictCheckStatus = ConflictCheckStatus.BLOCKED;
        request.conflictCheckedAt = new Date();
        request.conflictSummaryJson = {
          conflicts: conflicts.map((c) => ({
            bookingId: c.id,
            roomId: c.roomId,
            startTime: c.reservedStartTime,
            endTime: c.reservedEndTime,
            status: c.status,
          })),
          checkedAt: new Date().toISOString(),
        };
        await em.save(MeetingRequestEntity, request);

        throw new ConflictException({
          success: false,
          message: 'Phòng họp đã có booking khác trong khung giờ này',
          error: {
            code: 'ROOM_CONFLICT',
            details: {
              conflictingBookings: conflicts.map((c) => c.id),
            },
          },
        });
      }

      const now = new Date();
      const oldMeetingSnapshot = {
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        roomId: meeting.roomId,
      };
      const oldBookingStatus = booking.status;

      request.approvalStatus = ApprovalStatus.APPROVED;
      request.decisionBy = authUser.userId;
      request.decisionAt = now;
      request.appliedAt = now;
      request.conflictCheckStatus = ConflictCheckStatus.CLEAR;
      request.conflictCheckedAt = now;
      if (dto.decisionNote) {
        request.notes = dto.decisionNote;
      }
      await em.save(MeetingRequestEntity, request);

      meeting.status = MeetingStatus.SCHEDULED;
      meeting.startTime = targetStartTime;
      meeting.endTime = targetEndTime;
      meeting.roomId = targetRoomId;
      meeting.updatedBy = authUser.userId;
      meeting.updatedAt = now;
      await em.save(MeetingEntity, meeting);

      // CREATE_MEETING: PENDING → APPROVED (booking mới lần đầu được duyệt).
      // UPDATE_TIME/UPDATE_ROOM: booking "di chuyển" sang slot mới, GIỮ
      // nguyên status hiện có (APPROVED/ACTIVE) — không hạ cấp ACTIVE.
      booking.roomId = targetRoomId;
      booking.reservedStartTime = targetStartTime;
      booking.reservedEndTime = targetEndTime;
      if (booking.status === RoomBookingStatus.PENDING) {
        booking.status = RoomBookingStatus.APPROVED;
      }
      booking.approvedBy = authUser.userId;
      booking.approvedAt = now;
      await em.save(RoomBookingEntity, booking);

      let oldRoomName: string | null = null;
      let newRoomName: string | null = null;
      const roomChanged = oldMeetingSnapshot.roomId !== targetRoomId;

      if (isUpdateRequest) {
        if (roomChanged) {
          const [oldRoom, newRoom] = await Promise.all([
            oldMeetingSnapshot.roomId
              ? em.findOne(RoomEntity, {
                  where: { id: oldMeetingSnapshot.roomId },
                })
              : Promise.resolve(null),
            em.findOne(RoomEntity, { where: { id: targetRoomId } }),
          ]);
          oldRoomName = oldRoom?.roomName || oldMeetingSnapshot.roomId;
          newRoomName = newRoom?.roomName || targetRoomId;

          await em.save(RoomEventEntity, {
            roomId: oldMeetingSnapshot.roomId!,
            meetingId: meeting.id,
            bookingId: booking.id,
            eventType: 'room_released',
            sourceType: 'manual',
            actorUserId: authUser.userId,
            oldStatus: oldBookingStatus,
            newStatus: booking.status,
            description: `Phòng được giải phóng do đổi sang "${newRoomName}" (yêu cầu đã duyệt)`,
          });
          await em.save(RoomEventEntity, {
            roomId: targetRoomId,
            meetingId: meeting.id,
            bookingId: booking.id,
            eventType: 'room_reserved',
            sourceType: 'manual',
            actorUserId: authUser.userId,
            newStatus: booking.status,
            description: `Phòng được đặt từ "${oldRoomName}" (yêu cầu đã duyệt)`,
          });
        }

        const changeEvent = em.create(MeetingEventEntity, {
          meetingId: meeting.id,
          eventType:
            request.requestType === MeetingRequestType.UPDATE_ROOM
              ? MeetingEventType.ROOM_CHANGED
              : MeetingEventType.MEETING_TIME_UPDATED,
          actorUserId: authUser.userId,
          sourceType: MeetingEventSourceType.MANUAL,
          description: `Yêu cầu ${request.requestType === MeetingRequestType.UPDATE_ROOM ? 'đổi phòng' : 'đổi thời gian'} cuộc họp "${meeting.title}" đã được phê duyệt và áp dụng`,
          oldValueJson: oldMeetingSnapshot as any,
          newValueJson: {
            startTime: targetStartTime,
            endTime: targetEndTime,
            roomId: targetRoomId,
          } as any,
        });
        await em.save(MeetingEventEntity, changeEvent);
      }

      const event = em.create(MeetingEventEntity, {
        meetingId: meeting.id,
        eventType: MeetingEventType.MEETING_REQUEST_APPROVED,
        actorUserId: authUser.userId,
        sourceType: MeetingEventSourceType.MANUAL,
        description: `Yêu cầu cuộc họp "${meeting.title}" đã được phê duyệt`,
        oldValueJson: {
          approvalStatus: ApprovalStatus.PENDING,
          meetingStatus: MeetingStatus.PENDING_APPROVAL,
          bookingStatus: oldBookingStatus,
          ...oldMeetingSnapshot,
        } as any,
        newValueJson: {
          approvalStatus: ApprovalStatus.APPROVED,
          meetingStatus: MeetingStatus.SCHEDULED,
          bookingStatus: booking.status,
          startTime: targetStartTime,
          endTime: targetEndTime,
          roomId: targetRoomId,
        } as any,
      });
      await em.save(MeetingEventEntity, event);

      const participants = await em.find(MeetingParticipantEntity, {
        where: { meetingId: meeting.id },
      });
      const externalParticipants = await em.find(
        MeetingExternalParticipantEntity,
        {
          where: { meetingId: meeting.id },
        },
      );

      const participantIds = participants
        .map((p) => p.userId)
        .filter((id): id is string => !!id);
      const externalEmails = externalParticipants
        .map((ep) => ep.email)
        .filter((email): email is string => !!email);

      const auditLog = em.create(AuditLogEntity, {
        userId: authUser.userId,
        actionType: 'approve',
        entityType: 'meeting_request',
        entityId: requestId,
        oldValueJson: {
          approvalStatus: ApprovalStatus.PENDING,
          meetingStatus: MeetingStatus.PENDING_APPROVAL,
          bookingStatus: oldBookingStatus,
          ...oldMeetingSnapshot,
        },
        newValueJson: {
          approvalStatus: ApprovalStatus.APPROVED,
          meetingStatus: MeetingStatus.SCHEDULED,
          bookingStatus: booking.status,
          startTime: targetStartTime,
          endTime: targetEndTime,
          roomId: targetRoomId,
        },
        metadataJson: {
          meetingId: meeting.id,
          bookingId: booking.id,
          decisionNote: dto.decisionNote || null,
          requestId,
          requestType: request.requestType,
        },
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        severity: AuditLogSeverity.INFO,
      });
      await em.save(AuditLogEntity, auditLog);

      return {
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        meetingStartTime: targetStartTime,
        meetingEndTime: targetEndTime,
        requestType: request.requestType,
        bookingId: booking.id,
        appliedAt: now,
        participantIds,
        externalEmails,
        requesterId: request.requestedBy,
        hostId: meeting.hostId,
        decisionNote: dto.decisionNote || null,
        oldRoomName,
        newRoomName,
      };
    });

    // ── After transaction: enqueue notifications ──
    await this.enqueueApprovalNotifications(
      approvalResult,
      authUser,
      clientContext,
    );

    return new ApproveResponseDto({
      requestId,
      approvalStatus: ApprovalStatus.APPROVED,
      meetingId: approvalResult.meetingId,
      bookingId: approvalResult.bookingId,
      appliedAt: approvalResult.appliedAt,
    });
  }

  private async enqueueApprovalNotifications(
    result: MeetingApprovalResult,
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<void> {
    const meetingId = result.meetingId;
    const isUpdateRequest =
      result.requestType === MeetingRequestType.UPDATE_TIME ||
      result.requestType === MeetingRequestType.UPDATE_ROOM;

    // CREATE_MEETING: participants đang biết đến meeting LẦN ĐẦU → MEETING_INVITE.
    // UPDATE_TIME/UPDATE_ROOM: participants đã được mời từ trước, chỉ báo thay
    // đổi giờ/phòng vừa được áp dụng → MEETING_TIME_UPDATED/MEETING_ROOM_UPDATED.
    const notifType = !isUpdateRequest
      ? NotificationType.MEETING_INVITE
      : result.requestType === MeetingRequestType.UPDATE_ROOM
        ? NotificationType.MEETING_ROOM_UPDATED
        : NotificationType.MEETING_TIME_UPDATED;
    const subject = !isUpdateRequest
      ? `Thư mời tham dự cuộc họp: ${result.meetingTitle}`
      : result.requestType === MeetingRequestType.UPDATE_ROOM
        ? `Cập nhật phòng họp: ${result.meetingTitle}`
        : `Cập nhật thời gian cuộc họp: ${result.meetingTitle}`;
    const content = !isUpdateRequest
      ? `Bạn được mời tham dự cuộc họp "${result.meetingTitle}" vào lúc ${result.meetingStartTime.toISOString()}`
      : result.requestType === MeetingRequestType.UPDATE_ROOM
        ? `Phòng họp cho cuộc họp "${result.meetingTitle}" đã được thay đổi${result.oldRoomName && result.newRoomName ? ` từ "${result.oldRoomName}" sang "${result.newRoomName}"` : ''}.`
        : `Thời gian cuộc họp "${result.meetingTitle}" đã được cập nhật (${result.meetingStartTime.toISOString()} → ${result.meetingEndTime.toISOString()}).`;

    // 1. Internal participants — in-app
    for (const uid of result.participantIds) {
      try {
        await this.notificationsService.createNotification({
          notificationType: notifType,
          channel: NotificationChannel.IN_APP,
          subject,
          content,
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          recipientScope: 'user_list',
          recipientUserIds: [uid],
          createdBy: authUser.userId,
        });
      } catch (error) {
        this.logger.error(
          `[Approve] Failed to send IN_APP notify to participant ${uid}: ${(error as Error).message}`,
        );
        await this.writeNotificationFailureAudit(
          meetingId,
          authUser,
          clientContext,
          `Failed to notify participant ${uid}: ${(error as Error).message}`,
        );
      }
    }

    // 2. External participants — email (chỉ áp dụng cho CREATE_MEETING —
    // UPDATE_TIME/UPDATE_ROOM không đổi danh sách người ngoài công ty)
    if (!isUpdateRequest) {
      for (const email of result.externalEmails) {
        try {
          await this.notificationsService.enqueueEmailNotification({
            notificationType: notifType,
            channel: NotificationChannel.EMAIL,
            subject,
            content,
            toEmails: [email],
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            recipientScope: 'user_list',
            createdBy: authUser.userId,
          });
        } catch (error) {
          this.logger.error(
            `[Approve] Failed to send email to external ${email}: ${(error as Error).message}`,
          );
          await this.writeNotificationFailureAudit(
            meetingId,
            authUser,
            clientContext,
            `Failed to email external ${email}: ${(error as Error).message}`,
          );
        }
      }
    }

    // 3. Requester + host — in-app MEETING_REQUEST_APPROVED
    const notifyUserIds: string[] = [result.requesterId];
    if (result.hostId && !notifyUserIds.includes(result.hostId)) {
      notifyUserIds.push(result.hostId);
    }
    for (const uid of notifyUserIds) {
      try {
        await this.notificationsService.createNotification({
          notificationType: NotificationType.MEETING_REQUEST_APPROVED,
          channel: NotificationChannel.IN_APP,
          subject: `Yêu cầu cuộc họp "${result.meetingTitle}" đã được phê duyệt`,
          content: `Yêu cầu cuộc họp "${result.meetingTitle}" của bạn đã được phê duyệt`,
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          recipientScope: 'user_list',
          recipientUserIds: [uid],
          createdBy: authUser.userId,
        });
      } catch (error) {
        this.logger.error(
          `[Approve] Failed to send approved notify to ${uid}: ${(error as Error).message}`,
        );
        await this.writeNotificationFailureAudit(
          meetingId,
          authUser,
          clientContext,
          `Failed to notify ${uid} of approval: ${(error as Error).message}`,
        );
      }
    }
  }

  private async writeNotificationFailureAudit(
    meetingId: string,
    authUser: AuthUser,
    clientContext: ClientContext,
    detail: string,
  ): Promise<void> {
    try {
      await this.dataSource.manager.save(AuditLogEntity, {
        userId: authUser.userId,
        actionType: 'NOTIFICATION_FAILURE',
        entityType: 'meeting',
        entityId: meetingId,
        severity: AuditLogSeverity.WARNING,
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        metadataJson: { error: detail },
      } as any);
    } catch (auditError) {
      this.logger.error(
        `Failed to write notification failure audit log: ${(auditError as Error).message}`,
      );
    }
  }

  async reject(
    requestId: string,
    dto: RejectMeetingRequestDto,
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<RejectResponseDto> {
    const rejectResult = await this.dataSource.transaction(async (em) => {
      const request = await em.findOne(MeetingRequestEntity, {
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!request) {
        throw new NotFoundException({
          success: false,
          message: 'Không tìm thấy yêu cầu cuộc họp',
          error: {
            code: 'RESOURCE_NOT_FOUND',
            details: { entityType: 'meeting_request', entityId: requestId },
          },
        });
      }

      if (!SUPPORTED_REQUEST_TYPES.includes(request.requestType)) {
        throw new UnprocessableEntityException({
          success: false,
          message: 'Loại yêu cầu không được hỗ trợ',
          error: {
            code: 'UNSUPPORTED_REQUEST_TYPE',
            details: {
              requestType: request.requestType,
              supportedTypes: SUPPORTED_REQUEST_TYPES,
            },
          },
        });
      }

      const isUpdateRequest =
        request.requestType === MeetingRequestType.UPDATE_TIME ||
        request.requestType === MeetingRequestType.UPDATE_ROOM;

      if (request.approvalStatus !== ApprovalStatus.PENDING) {
        throw new ConflictException({
          success: false,
          message: 'Yêu cầu cuộc họp không còn trạng thái chờ duyệt',
          error: {
            code: 'INVALID_STATE',
            details: {
              currentStatus: request.approvalStatus,
              expectedStatus: ApprovalStatus.PENDING,
            },
          },
        });
      }

      const meeting = await em.findOne(MeetingEntity, {
        where: { id: request.meetingId! },
      });

      if (!meeting) {
        throw new NotFoundException({
          success: false,
          message: 'Không tìm thấy cuộc họp liên quan',
          error: {
            code: 'RESOURCE_NOT_FOUND',
            details: { entityType: 'meeting', entityId: request.meetingId },
          },
        });
      }

      if (meeting.status !== MeetingStatus.PENDING_APPROVAL) {
        throw new ConflictException({
          success: false,
          message: 'Cuộc họp không còn trạng thái chờ phê duyệt',
          error: {
            code: 'INVALID_STATE',
            details: {
              currentStatus: meeting.status,
              expectedStatus: MeetingStatus.PENDING_APPROVAL,
            },
          },
        });
      }

      // Loại RELEASED/CANCELLED — 1 meeting có thể có nhiều dòng booking lịch
      // sử (vd đổi phòng khi còn PENDING_APPROVAL tạo booking mới, release
      // booking cũ). orderBy createdAt DESC để lấy booking đang hiệu lực gần
      // nhất nếu có nhiều hơn 1 dòng active (không nên xảy ra, phòng thủ).
      const booking = await em.findOne(RoomBookingEntity, {
        where: {
          meetingId: meeting.id,
          status: In([
            RoomBookingStatus.PENDING,
            RoomBookingStatus.APPROVED,
            RoomBookingStatus.ACTIVE,
          ]),
        },
        order: { createdAt: 'DESC' },
      });

      if (!booking) {
        throw new NotFoundException({
          success: false,
          message: 'Không tìm thấy booking phòng họp liên quan',
          error: {
            code: 'RESOURCE_NOT_FOUND',
            details: { entityType: 'room_booking', entityId: meeting.id },
          },
        });
      }

      const expectedBookingStatuses = isUpdateRequest
        ? [RoomBookingStatus.APPROVED, RoomBookingStatus.ACTIVE]
        : [RoomBookingStatus.PENDING];
      if (!expectedBookingStatuses.includes(booking.status)) {
        throw new ConflictException({
          success: false,
          message: 'Booking phòng họp không còn ở trạng thái hợp lệ để từ chối',
          error: {
            code: 'INVALID_STATE',
            details: {
              currentStatus: booking.status,
              expectedStatus: expectedBookingStatuses,
            },
          },
        });
      }

      if (
        request.requestedBy === authUser.userId ||
        meeting.organizerId === authUser.userId
      ) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không thể tự duyệt yêu cầu cuộc họp do chính mình tạo',
          error: { code: 'SELF_APPROVAL_NOT_ALLOWED' },
        });
      }

      const now = new Date();
      const oldBookingStatus = booking.status;

      request.approvalStatus = ApprovalStatus.REJECTED;
      request.rejectionReason = dto.rejectionReason;
      request.decisionBy = authUser.userId;
      request.decisionAt = now;
      await em.save(MeetingRequestEntity, request);

      if (isUpdateRequest) {
        // UPDATE_TIME/UPDATE_ROOM bị từ chối: meeting quay lại SCHEDULED với
        // giờ/phòng CŨ — KHÔNG đổi gì trên meeting (1c chưa từng áp dụng thay
        // đổi), KHÔNG đụng booking (vẫn đang giữ đúng slot cũ).
        meeting.status = MeetingStatus.SCHEDULED;
        meeting.updatedBy = authUser.userId;
        meeting.updatedAt = now;
        await em.save(MeetingEntity, meeting);
      } else {
        meeting.status = MeetingStatus.CANCELLED;
        meeting.cancellationReason = dto.rejectionReason;
        meeting.updatedBy = authUser.userId;
        meeting.updatedAt = now;
        await em.save(MeetingEntity, meeting);

        booking.status = RoomBookingStatus.CANCELLED;
        booking.cancellationReason = dto.rejectionReason;
        await em.save(RoomBookingEntity, booking);
      }

      const event = em.create(MeetingEventEntity, {
        meetingId: meeting.id,
        eventType: MeetingEventType.MEETING_REQUEST_REJECTED,
        actorUserId: authUser.userId,
        sourceType: MeetingEventSourceType.MANUAL,
        description: isUpdateRequest
          ? `Yêu cầu ${request.requestType === MeetingRequestType.UPDATE_ROOM ? 'đổi phòng' : 'đổi thời gian'} cuộc họp "${meeting.title}" đã bị từ chối. Giữ nguyên lịch cũ. Lý do: ${dto.rejectionReason}`
          : `Yêu cầu cuộc họp "${meeting.title}" đã bị từ chối. Lý do: ${dto.rejectionReason}`,
        oldValueJson: {
          approvalStatus: ApprovalStatus.PENDING,
          meetingStatus: MeetingStatus.PENDING_APPROVAL,
          bookingStatus: oldBookingStatus,
        } as any,
        newValueJson: {
          approvalStatus: ApprovalStatus.REJECTED,
          meetingStatus: meeting.status,
          bookingStatus: booking.status,
        } as any,
      });
      await em.save(MeetingEventEntity, event);

      const auditLog = em.create(AuditLogEntity, {
        userId: authUser.userId,
        actionType: 'reject',
        entityType: 'meeting_request',
        entityId: requestId,
        oldValueJson: {
          approvalStatus: ApprovalStatus.PENDING,
          meetingStatus: MeetingStatus.PENDING_APPROVAL,
          bookingStatus: oldBookingStatus,
        },
        newValueJson: {
          approvalStatus: ApprovalStatus.REJECTED,
          meetingStatus: meeting.status,
          bookingStatus: booking.status,
        },
        metadataJson: {
          meetingId: meeting.id,
          bookingId: booking.id,
          rejectionReason: dto.rejectionReason,
          requestId,
          requestType: request.requestType,
        },
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        severity: AuditLogSeverity.INFO,
      });
      await em.save(AuditLogEntity, auditLog);

      return {
        meetingTitle: meeting.title,
        meetingId: meeting.id,
        appliedAt: now,
        requesterId: request.requestedBy,
        hostId: meeting.hostId,
      };
    });

    // ── After transaction: enqueue notification ──
    await this.enqueueRejectionNotifications(
      rejectResult,
      authUser,
      clientContext,
    );

    return new RejectResponseDto({
      requestId,
      approvalStatus: ApprovalStatus.REJECTED,
      decisionAt: rejectResult.appliedAt,
    });
  }

  private async enqueueRejectionNotifications(
    result: {
      meetingTitle: string;
      meetingId: string;
      requesterId: string;
      hostId: string | null;
    },
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<void> {
    const notifyUserIds: string[] = [result.requesterId];
    if (result.hostId && !notifyUserIds.includes(result.hostId)) {
      notifyUserIds.push(result.hostId);
    }
    for (const uid of notifyUserIds) {
      try {
        await this.notificationsService.createNotification({
          notificationType: NotificationType.MEETING_REQUEST_REJECTED,
          channel: NotificationChannel.IN_APP,
          subject: `Yêu cầu cuộc họp "${result.meetingTitle}" đã bị từ chối`,
          content: `Yêu cầu cuộc họp "${result.meetingTitle}" của bạn đã bị từ chối.`,
          relatedEntityType: 'meeting',
          relatedEntityId: result.meetingId,
          recipientScope: 'user_list',
          recipientUserIds: [uid],
          createdBy: authUser.userId,
        });
      } catch (error) {
        this.logger.error(
          `[Reject] Failed to send rejection notify to ${uid}: ${(error as Error).message}`,
        );
        await this.writeNotificationFailureAudit(
          result.meetingId,
          authUser,
          clientContext,
          `Failed to notify ${uid} of rejection: ${(error as Error).message}`,
        );
      }
    }
  }
}
