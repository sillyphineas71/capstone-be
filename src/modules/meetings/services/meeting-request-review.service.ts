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

interface MeetingApprovalResult {
  meetingId: string;
  meetingTitle: string;
  meetingStartTime: Date;
  bookingId: string;
  appliedAt: Date;
  participantIds: string[];
  externalEmails: string[];
  requesterId: string;
  hostId: string | null;
  decisionNote: string | null;
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

      if (request.requestType !== MeetingRequestType.CREATE_MEETING) {
        throw new UnprocessableEntityException({
          success: false,
          message: 'Loại yêu cầu không được hỗ trợ',
          error: {
            code: 'UNSUPPORTED_REQUEST_TYPE',
            details: {
              requestType: request.requestType,
              supportedTypes: [MeetingRequestType.CREATE_MEETING],
            },
          },
        });
      }

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

      const booking = await em.findOne(RoomBookingEntity, {
        where: { meetingId: meeting.id },
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

      if (booking.status !== RoomBookingStatus.PENDING) {
        throw new ConflictException({
          success: false,
          message: 'Booking phòng họp không còn trạng thái chờ duyệt',
          error: {
            code: 'INVALID_STATE',
            details: {
              currentStatus: booking.status,
              expectedStatus: RoomBookingStatus.PENDING,
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

      const conflicts = await em.getRepository(RoomBookingEntity).find({
        where: {
          roomId: booking.roomId,
          id: Not(booking.id),
          status: In([
            RoomBookingStatus.PENDING,
            RoomBookingStatus.APPROVED,
            RoomBookingStatus.ACTIVE,
          ]),
          reservedStartTime: LessThanOrEqual(meeting.endTime),
          reservedEndTime: MoreThanOrEqual(meeting.startTime),
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
      meeting.updatedBy = authUser.userId;
      meeting.updatedAt = now;
      await em.save(MeetingEntity, meeting);

      booking.status = RoomBookingStatus.APPROVED;
      booking.approvedBy = authUser.userId;
      booking.approvedAt = now;
      await em.save(RoomBookingEntity, booking);

      const event = em.create(MeetingEventEntity, {
        meetingId: meeting.id,
        eventType: MeetingEventType.MEETING_REQUEST_APPROVED,
        actorUserId: authUser.userId,
        sourceType: MeetingEventSourceType.MANUAL,
        description: `Yêu cầu cuộc họp "${meeting.title}" đã được phê duyệt`,
        oldValueJson: {
          approvalStatus: ApprovalStatus.PENDING,
          meetingStatus: MeetingStatus.PENDING_APPROVAL,
          bookingStatus: RoomBookingStatus.PENDING,
        } as any,
        newValueJson: {
          approvalStatus: ApprovalStatus.APPROVED,
          meetingStatus: MeetingStatus.SCHEDULED,
          bookingStatus: RoomBookingStatus.APPROVED,
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
          bookingStatus: RoomBookingStatus.PENDING,
        },
        newValueJson: {
          approvalStatus: ApprovalStatus.APPROVED,
          meetingStatus: MeetingStatus.SCHEDULED,
          bookingStatus: RoomBookingStatus.APPROVED,
        },
        metadataJson: {
          meetingId: meeting.id,
          bookingId: booking.id,
          decisionNote: dto.decisionNote || null,
          requestId,
        },
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        severity: AuditLogSeverity.INFO,
      });
      await em.save(AuditLogEntity, auditLog);

      return {
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        meetingStartTime: meeting.startTime,
        bookingId: booking.id,
        appliedAt: now,
        participantIds,
        externalEmails,
        requesterId: request.requestedBy,
        hostId: meeting.hostId,
        decisionNote: dto.decisionNote || null,
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

    // 1. Internal participants — in-app only MEETING_INVITE (email skipped to reduce load on the email service)
    for (const uid of result.participantIds) {
      try {
        await this.notificationsService.createNotification({
          notificationType: NotificationType.MEETING_INVITE,
          channel: NotificationChannel.IN_APP,
          subject: `Thư mời tham dự cuộc họp: ${result.meetingTitle}`,
          content: `Bạn được mời tham dự cuộc họp "${result.meetingTitle}" vào lúc ${result.meetingStartTime.toISOString()}`,
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

    // 2. External participants — email MEETING_INVITE
    for (const email of result.externalEmails) {
      try {
        await this.notificationsService.enqueueEmailNotification({
          notificationType: NotificationType.MEETING_INVITE,
          channel: NotificationChannel.EMAIL,
          subject: `Thư mời tham dự cuộc họp: ${result.meetingTitle}`,
          content: `Bạn được mời tham dự cuộc họp "${result.meetingTitle}" vào lúc ${result.meetingStartTime.toISOString()}`,
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

      if (request.requestType !== MeetingRequestType.CREATE_MEETING) {
        throw new UnprocessableEntityException({
          success: false,
          message: 'Loại yêu cầu không được hỗ trợ',
          error: {
            code: 'UNSUPPORTED_REQUEST_TYPE',
            details: {
              requestType: request.requestType,
              supportedTypes: [MeetingRequestType.CREATE_MEETING],
            },
          },
        });
      }

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

      const booking = await em.findOne(RoomBookingEntity, {
        where: { meetingId: meeting.id },
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

      if (booking.status !== RoomBookingStatus.PENDING) {
        throw new ConflictException({
          success: false,
          message: 'Booking phòng họp không còn trạng thái chờ duyệt',
          error: {
            code: 'INVALID_STATE',
            details: {
              currentStatus: booking.status,
              expectedStatus: RoomBookingStatus.PENDING,
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

      request.approvalStatus = ApprovalStatus.REJECTED;
      request.rejectionReason = dto.rejectionReason;
      request.decisionBy = authUser.userId;
      request.decisionAt = now;
      await em.save(MeetingRequestEntity, request);

      meeting.status = MeetingStatus.CANCELLED;
      meeting.cancellationReason = dto.rejectionReason;
      meeting.updatedBy = authUser.userId;
      meeting.updatedAt = now;
      await em.save(MeetingEntity, meeting);

      booking.status = RoomBookingStatus.CANCELLED;
      booking.cancellationReason = dto.rejectionReason;
      await em.save(RoomBookingEntity, booking);

      const event = em.create(MeetingEventEntity, {
        meetingId: meeting.id,
        eventType: MeetingEventType.MEETING_REQUEST_REJECTED,
        actorUserId: authUser.userId,
        sourceType: MeetingEventSourceType.MANUAL,
        description: `Yêu cầu cuộc họp "${meeting.title}" đã bị từ chối. Lý do: ${dto.rejectionReason}`,
        oldValueJson: {
          approvalStatus: ApprovalStatus.PENDING,
          meetingStatus: MeetingStatus.PENDING_APPROVAL,
          bookingStatus: RoomBookingStatus.PENDING,
        } as any,
        newValueJson: {
          approvalStatus: ApprovalStatus.REJECTED,
          meetingStatus: MeetingStatus.CANCELLED,
          bookingStatus: RoomBookingStatus.CANCELLED,
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
          bookingStatus: RoomBookingStatus.PENDING,
        },
        newValueJson: {
          approvalStatus: ApprovalStatus.REJECTED,
          meetingStatus: MeetingStatus.CANCELLED,
          bookingStatus: RoomBookingStatus.CANCELLED,
        },
        metadataJson: {
          meetingId: meeting.id,
          bookingId: booking.id,
          rejectionReason: dto.rejectionReason,
          requestId,
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
    // Only the host is notified of a rejection — in-app only, no email.
    const hostUserId = result.hostId ?? result.requesterId;
    try {
      await this.notificationsService.createNotification({
        notificationType: NotificationType.MEETING_REQUEST_REJECTED,
        channel: NotificationChannel.IN_APP,
        subject: `Yêu cầu cuộc họp "${result.meetingTitle}" đã bị từ chối`,
        content: `Yêu cầu cuộc họp "${result.meetingTitle}" của bạn đã bị từ chối.`,
        relatedEntityType: 'meeting',
        relatedEntityId: result.meetingId,
        recipientScope: 'user_list',
        recipientUserIds: [hostUserId],
        createdBy: authUser.userId,
      });
    } catch (error) {
      this.logger.error(
        `[Reject] Failed to send rejection notify to ${hostUserId}: ${(error as Error).message}`,
      );
      await this.writeNotificationFailureAudit(
        result.meetingId,
        authUser,
        clientContext,
        `Failed to notify ${hostUserId} of rejection: ${(error as Error).message}`,
      );
    }
  }
}
