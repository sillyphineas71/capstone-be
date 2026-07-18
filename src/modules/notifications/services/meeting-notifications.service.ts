import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';

import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationType,
} from '../entities/notification.entity.js';
import { NotificationsService } from '../notifications.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';

import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../../meetings/entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../../meetings/entities/meeting-external-participant.entity.js';
import { MeetingAgendaEntity } from '../../meetings/entities/meeting-agenda.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
} from '../../minutes/entities/meeting-minutes.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';

import { SendMeetingInvitationDto } from '../dto/send-meeting-invitation.dto.js';
import { SendMeetingReminderDto } from '../dto/send-meeting-reminder.dto.js';
import { ResendCancellationNotificationDto } from '../dto/resend-cancellation-notification.dto.js';
import { DistributeMeetingMinutesDto } from '../dto/distribute-meeting-minutes.dto.js';

interface AuthUser {
  userId: string;
}

/**
 * MeetingNotificationsService — Service cho nhóm UC-143..146:
 * gửi invitation, reminder, cancellation notification, distribute minutes.
 *
 * KHÔNG import MeetingsModule để tránh circular dependency.
 * Chỉ inject repository đọc các entity cần thiết.
 */
@Injectable()
export class MeetingNotificationsService {
  private readonly logger = new Logger(MeetingNotificationsService.name);

  constructor(
    @InjectRepository(MeetingEntity)
    private readonly meetingRepo: Repository<MeetingEntity>,
    @InjectRepository(MeetingParticipantEntity)
    private readonly participantRepo: Repository<MeetingParticipantEntity>,
    @InjectRepository(MeetingExternalParticipantEntity)
    private readonly externalParticipantRepo: Repository<MeetingExternalParticipantEntity>,
    @InjectRepository(MeetingAgendaEntity)
    private readonly agendaRepo: Repository<MeetingAgendaEntity>,
    @InjectRepository(MeetingMinutesEntity)
    private readonly minutesRepo: Repository<MeetingMinutesEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly notificationsService: NotificationsService,
    private readonly authzReadRepo: AuthzReadRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly configService: ConfigService,
  ) {}

  // ──────────────────────────────────────────────
  //  UC-143: Send / Resend Meeting Invitation
  // ──────────────────────────────────────────────
  async sendMeetingInvitation(
    meetingId: string,
    authUser: AuthUser,
    dto: SendMeetingInvitationDto,
  ): Promise<{
    notificationId: string;
    deliveryStatus: string;
    queuedRecipientCount: number;
    skippedRecipientCount: number;
  }> {
    const meeting = await this.findMeetingOrThrow(meetingId);
    await this.ensureOwnershipOrAdmin(meeting, authUser);
    this.ensureNotCancelled(meeting);

    const { internalParticipants, externalParticipants } =
      await this.loadParticipants(meetingId);
    const content = await this.buildInvitationContent(meeting, dto);
    const userIds = this.dedupIds([
      ...internalParticipants.map((p) => p.userId),
      meeting.organizerId,
      ...(meeting.hostId ? [meeting.hostId] : []),
    ]);

    let notificationId: string | undefined;
    let deliveryStatus: string = NotificationDeliveryStatus.DRAFT;
    let queued = 0;
    let skipped = 0;

    if (dto.channels.includes('in_app')) {
      const n = await this.notificationsService.createNotification({
        notificationType: NotificationType.MEETING_INVITE,
        channel: NotificationChannel.IN_APP,
        subject: 'Thư mời họp: ' + meeting.title,
        content,
        relatedEntityType: 'meeting',
        relatedEntityId: meetingId,
        recipientUserIds: userIds,
        createdBy: authUser.userId,
        payloadJson: { meetingTitle: meeting.title, channels: dto.channels },
      });
      notificationId = n.id;
      deliveryStatus = n.deliveryStatus;
      queued += userIds.length;
    }

    if (dto.channels.includes('email')) {
      const emails: string[] = [];
      for (const p of internalParticipants) {
        const user = await this.userRepo.findOne({ where: { id: p.userId } });
        if (user?.email) emails.push(user.email);
        else skipped++;
      }
      for (const ep of externalParticipants) {
        if (ep.email) emails.push(ep.email);
      }
      if (emails.length > 0) {
        const result = await this.notificationsService.enqueueEmailNotification(
          {
            notificationType: NotificationType.MEETING_INVITE,
            channel: NotificationChannel.EMAIL,
            subject: 'Thư mời họp: ' + meeting.title,
            content,
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            toEmails: emails,
            createdBy: authUser.userId,
          },
        );
        if (!notificationId) {
          notificationId = result.notification.id;
          deliveryStatus = result.notification.deliveryStatus;
        }
        queued += emails.length;
      }
    }

    await this.auditLogsService.logAction({
      userId: authUser.userId,
      actionType: 'meeting_invitation_sent',
      entityType: 'meeting',
      entityId: meetingId,
      metadataJson: {
        queuedRecipientCount: queued,
        skippedRecipientCount: skipped,
        channels: dto.channels,
      },
    });

    this.logger.log(
      '[MeetingNotifications] Invitation sent — meeting=' +
        meetingId +
        ', queued=' +
        queued +
        ', skipped=' +
        skipped,
    );
    return {
      notificationId: notificationId ?? '',
      deliveryStatus,
      queuedRecipientCount: queued,
      skippedRecipientCount: skipped,
    };
  }

  // ──────────────────────────────────────────────
  //  UC-144: Send Meeting Reminder
  // ──────────────────────────────────────────────
  async sendMeetingReminder(
    meetingId: string,
    authUser: AuthUser,
    dto: SendMeetingReminderDto,
  ): Promise<{
    notificationId: string;
    deliveryStatus: string;
    scheduledSendAt: string | null;
  }> {
    const meeting = await this.findMeetingOrThrow(meetingId);
    await this.ensureOwnershipOrAdmin(meeting, authUser);
    this.ensureMeetingIsUpcoming(meeting);

    const { internalParticipants, externalParticipants } =
      await this.loadParticipants(meetingId);
    const content = this.buildReminderContent(meeting);

    if (dto.reminderType === 'scheduled') {
      if (!dto.sendAt) {
        throw new BadRequestException({
          success: false,
          message: 'sendAt is required when reminderType=scheduled',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }
      const sendAtDate = new Date(dto.sendAt);
      if (isNaN(sendAtDate.getTime()) || sendAtDate <= new Date()) {
        throw new BadRequestException({
          success: false,
          message: 'sendAt must be a future datetime',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }
      if (sendAtDate >= new Date(meeting.startTime)) {
        throw new ConflictException({
          success: false,
          message: 'sendAt must be before meeting start time',
          error: { code: 'REMINDER_AFTER_MEETING_START', details: {} },
        });
      }

      // Tạo 1 row draft/scheduled cho MỖI channel được yêu cầu (không hardcode IN_APP) —
      // dispatcher tương lai (SchedulerService.sendReminders(), hiện là TODO) sẽ đọc đúng
      // channel của từng row khi tới hạn sendAt.
      let notificationId: string | undefined;
      let deliveryStatus: string = NotificationDeliveryStatus.DRAFT;
      const recipientUserIds = internalParticipants.map((p) => p.userId);

      for (const channel of dto.channels) {
        const n = await this.notificationsService.createNotification({
          notificationType: NotificationType.REMINDER,
          channel:
            channel === 'email'
              ? NotificationChannel.EMAIL
              : NotificationChannel.IN_APP,
          subject: 'Nhắc lịch họp: ' + meeting.title,
          content,
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          recipientUserIds,
          scheduledSendAt: sendAtDate,
          createdBy: authUser.userId,
          payloadJson: {
            reminderType: 'scheduled',
            meetingTitle: meeting.title,
          },
        });
        if (!notificationId) {
          notificationId = n.id;
          deliveryStatus = n.deliveryStatus;
        }
      }

      await this.auditLogsService.logAction({
        userId: authUser.userId,
        actionType: 'meeting_reminder_scheduled',
        entityType: 'meeting',
        entityId: meetingId,
        metadataJson: {
          reminderType: 'scheduled',
          sendAt: dto.sendAt,
          channels: dto.channels,
        },
      });

      return {
        notificationId: notificationId ?? '',
        deliveryStatus,
        scheduledSendAt: dto.sendAt,
      };
    }

    // manual — send immediately
    const userIds = this.dedupIds([
      ...internalParticipants.map((p) => p.userId),
      meeting.organizerId,
      ...(meeting.hostId ? [meeting.hostId] : []),
    ]);

    let notificationId: string | undefined;
    let deliveryStatus: string = NotificationDeliveryStatus.DRAFT;

    if (dto.channels.includes('in_app')) {
      const n = await this.notificationsService.createNotification({
        notificationType: NotificationType.REMINDER,
        channel: NotificationChannel.IN_APP,
        subject: 'Nhắc lịch họp: ' + meeting.title,
        content,
        relatedEntityType: 'meeting',
        relatedEntityId: meetingId,
        recipientUserIds: userIds,
        createdBy: authUser.userId,
        payloadJson: { reminderType: 'manual' },
      });
      notificationId = n.id;
      deliveryStatus = n.deliveryStatus;
    }

    if (dto.channels.includes('email')) {
      const emails: string[] = [];
      for (const p of internalParticipants) {
        const user = await this.userRepo.findOne({ where: { id: p.userId } });
        if (user?.email) emails.push(user.email);
      }
      for (const ep of externalParticipants) {
        if (ep.email) emails.push(ep.email);
      }
      if (emails.length > 0) {
        const result = await this.notificationsService.enqueueEmailNotification(
          {
            notificationType: NotificationType.REMINDER,
            channel: NotificationChannel.EMAIL,
            subject: 'Nhắc lịch họp: ' + meeting.title,
            content,
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            toEmails: emails,
            createdBy: authUser.userId,
          },
        );
        if (!notificationId) {
          notificationId = result.notification.id;
          deliveryStatus = result.notification.deliveryStatus;
        }
      }
    }

    await this.auditLogsService.logAction({
      userId: authUser.userId,
      actionType: 'meeting_reminder_sent',
      entityType: 'meeting',
      entityId: meetingId,
      metadataJson: { reminderType: 'manual', channels: dto.channels },
    });

    this.logger.log(
      '[MeetingNotifications] Reminder sent — meeting=' +
        meetingId +
        ', type=manual',
    );
    return {
      notificationId: notificationId ?? '',
      deliveryStatus,
      scheduledSendAt: null,
    };
  }

  // ──────────────────────────────────────────────
  //  UC-145: Resend Cancellation Notification
  // ──────────────────────────────────────────────
  async resendCancellationNotification(
    meetingId: string,
    authUser: AuthUser,
    dto: ResendCancellationNotificationDto,
  ): Promise<{
    meetingId: string;
    notificationId: string;
    queuedRecipientCount: number;
  }> {
    const meeting = await this.findMeetingOrThrow(meetingId);
    await this.ensureOwnershipOrAdmin(meeting, authUser);

    if (meeting.status !== MeetingStatus.CANCELLED) {
      throw new ConflictException({
        success: false,
        message: 'Meeting is not cancelled',
        error: { code: 'MEETING_NOT_CANCELLED', details: {} },
      });
    }

    const { internalParticipants, externalParticipants } =
      await this.loadParticipants(meetingId);
    const reason = dto.reason ?? meeting.cancellationReason ?? 'Không có lý do';
    const content = this.buildCancellationContent(meeting, reason);

    const userIds = this.dedupIds([
      ...internalParticipants.map((p) => p.userId),
      meeting.organizerId,
      ...(meeting.hostId ? [meeting.hostId] : []),
    ]);

    let notificationId: string | undefined;
    let queued = 0;

    if (dto.channels.includes('in_app')) {
      const n = await this.notificationsService.createNotification({
        notificationType: NotificationType.CANCELLATION,
        channel: NotificationChannel.IN_APP,
        subject: 'Hủy cuộc họp: ' + meeting.title,
        content,
        relatedEntityType: 'meeting',
        relatedEntityId: meetingId,
        recipientUserIds: userIds,
        createdBy: authUser.userId,
      });
      notificationId = n.id;
      queued += userIds.length;
    }

    if (dto.channels.includes('email')) {
      const emails: string[] = [];
      for (const p of internalParticipants) {
        const user = await this.userRepo.findOne({ where: { id: p.userId } });
        if (user?.email) emails.push(user.email);
      }
      for (const ep of externalParticipants) {
        if (ep.email) emails.push(ep.email);
      }
      if (emails.length > 0) {
        const result = await this.notificationsService.enqueueEmailNotification(
          {
            notificationType: NotificationType.CANCELLATION,
            channel: NotificationChannel.EMAIL,
            subject: 'Hủy cuộc họp: ' + meeting.title,
            content,
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            toEmails: emails,
            createdBy: authUser.userId,
          },
        );
        if (!notificationId) {
          notificationId = result.notification.id;
        }
        queued += emails.length;
      }
    }

    await this.auditLogsService.logAction({
      userId: authUser.userId,
      actionType: 'meeting_cancellation_notification_resent',
      entityType: 'meeting',
      entityId: meetingId,
      metadataJson: {
        queuedRecipientCount: queued,
        reason,
        channels: dto.channels,
      },
    });

    this.logger.log(
      '[MeetingNotifications] Cancellation resent — meeting=' +
        meetingId +
        ', queued=' +
        queued,
    );
    return {
      meetingId,
      notificationId: notificationId ?? '',
      queuedRecipientCount: queued,
    };
  }

  // ──────────────────────────────────────────────
  //  UC-146: Distribute Meeting Minutes
  // ──────────────────────────────────────────────
  async distributeMeetingMinutes(
    meetingId: string,
    authUser: AuthUser,
    dto: DistributeMeetingMinutesDto,
  ): Promise<{
    notificationId: string;
    queuedRecipientCount: number;
    minutesId: string;
  }> {
    const meeting = await this.findMeetingOrThrow(meetingId);
    const minutes = await this.minutesRepo.findOne({
      where: { id: dto.minutesId, meetingId },
    });
    if (!minutes || minutes.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Meeting minutes not found or does not belong to this meeting',
        error: { code: 'MINUTES_NOT_FOUND', details: {} },
      });
    }
    await this.ensureMinutesOwnerOrAdmin(meeting, minutes, authUser);
    if (minutes.status !== MeetingMinutesStatus.PUBLISHED) {
      throw new ConflictException({
        success: false,
        message: 'Minutes must be published to distribute',
        error: { code: 'MINUTES_NOT_PUBLISHED', details: {} },
      });
    }

    let queued = 0;
    let skipped = 0;
    let userIds: string[] = [];
    let internalParticipants: MeetingParticipantEntity[] = [];
    let externalParticipants: MeetingExternalParticipantEntity[] = [];

    if (dto.recipientScope === 'participants') {
      const participants = await this.loadParticipants(meetingId);
      internalParticipants = participants.internalParticipants;
      externalParticipants = participants.externalParticipants;
      userIds = internalParticipants.map((p) => p.userId);
    } else {
      // custom
      if (!dto.recipientUserIds || dto.recipientUserIds.length === 0) {
        throw new BadRequestException({
          success: false,
          message: 'recipientUserIds is required when recipientScope=custom',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }
      userIds = dto.recipientUserIds;
    }

    const content = this.buildMinutesDistributionContent(
      meeting,
      minutes,
      dto.message,
    );

    let notificationId: string | undefined;

    if (dto.channels.includes('in_app')) {
      const validUserIds: string[] = [];
      for (const uid of userIds) {
        const user = await this.userRepo.findOne({ where: { id: uid } });
        if (user) validUserIds.push(uid);
        else skipped++;
      }
      if (validUserIds.length > 0) {
        const n = await this.notificationsService.createNotification({
          notificationType: NotificationType.MINUTES_DISTRIBUTION,
          channel: NotificationChannel.IN_APP,
          subject: 'Biên bản họp đã được ban hành: ' + meeting.title,
          content,
          relatedEntityType: 'meeting_minutes',
          relatedEntityId: minutes.id,
          recipientUserIds: validUserIds,
          createdBy: authUser.userId,
        });
        notificationId = n.id;
        queued += validUserIds.length;
      }
    }

    if (dto.channels.includes('email')) {
      const emails: string[] = [];
      if (dto.recipientScope === 'participants') {
        for (const p of internalParticipants) {
          const user = await this.userRepo.findOne({ where: { id: p.userId } });
          if (user?.email) emails.push(user.email);
        }
        for (const ep of externalParticipants) {
          if (ep.email) emails.push(ep.email);
        }
      } else {
        for (const uid of userIds) {
          const user = await this.userRepo.findOne({ where: { id: uid } });
          if (user?.email) emails.push(user.email);
          else skipped++;
        }
      }
      if (emails.length > 0) {
        const result = await this.notificationsService.enqueueEmailNotification(
          {
            notificationType: NotificationType.MINUTES_DISTRIBUTION,
            channel: NotificationChannel.EMAIL,
            subject: 'Biên bản họp đã được ban hành: ' + meeting.title,
            content,
            relatedEntityType: 'meeting_minutes',
            relatedEntityId: minutes.id,
            toEmails: emails,
            createdBy: authUser.userId,
          },
        );
        if (!notificationId) {
          notificationId = result.notification.id;
        }
        queued += emails.length;
      }
    }

    await this.auditLogsService.logAction({
      userId: authUser.userId,
      actionType: 'meeting_minutes_distributed',
      entityType: 'meeting_minutes',
      entityId: minutes.id,
      metadataJson: {
        meetingId,
        recipientScope: dto.recipientScope,
        queuedRecipientCount: queued,
        skippedRecipientCount: skipped,
      },
    });

    this.logger.log(
      '[MeetingNotifications] Minutes distributed — minutes=' +
        minutes.id +
        ', meeting=' +
        meetingId +
        ', queued=' +
        queued +
        ', skipped=' +
        skipped,
    );
    return {
      notificationId: notificationId ?? '',
      queuedRecipientCount: queued,
      minutesId: minutes.id,
    };
  }

  // ───────────── Private helpers ─────────────

  private async findMeetingOrThrow(meetingId: string): Promise<MeetingEntity> {
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId },
    });
    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Meeting not found or deleted',
        error: { code: 'MEETING_NOT_FOUND', details: {} },
      });
    }
    return meeting;
  }

  private async ensureOwnershipOrAdmin(
    meeting: MeetingEntity,
    authUser: AuthUser,
  ): Promise<void> {
    const isOwner =
      meeting.organizerId === authUser.userId ||
      meeting.hostId === authUser.userId;
    if (isOwner) return;
    const { roles } = await this.authzReadRepo.getEffectiveRolesAndPermissions(
      authUser.userId,
    );
    if (roles.includes('BUSINESS_ADMIN') || roles.includes('SYSTEM_ADMIN'))
      return;
    throw new ForbiddenException({
      success: false,
      message: 'You are not the meeting owner or an admin',
      error: { code: 'NOT_MEETING_OWNER', details: {} },
    });
  }

  private async ensureMinutesOwnerOrAdmin(
    meeting: MeetingEntity,
    minutes: MeetingMinutesEntity,
    authUser: AuthUser,
  ): Promise<void> {
    const isOwner =
      minutes.preparedBy === authUser.userId ||
      meeting.organizerId === authUser.userId ||
      meeting.hostId === authUser.userId;
    if (isOwner) return;
    const { roles } = await this.authzReadRepo.getEffectiveRolesAndPermissions(
      authUser.userId,
    );
    if (roles.includes('BUSINESS_ADMIN') || roles.includes('SYSTEM_ADMIN'))
      return;
    throw new ForbiddenException({
      success: false,
      message: 'You are not the minutes owner or an admin',
      error: { code: 'NOT_MINUTES_OWNER', details: {} },
    });
  }

  private ensureNotCancelled(meeting: MeetingEntity): void {
    if (meeting.status === MeetingStatus.CANCELLED) {
      throw new ConflictException({
        success: false,
        message: 'Meeting is cancelled, cannot send invitations',
        error: { code: 'MEETING_CANCELLED', details: {} },
      });
    }
  }

  private ensureMeetingIsUpcoming(meeting: MeetingEntity): void {
    if (
      meeting.status !== MeetingStatus.SCHEDULED ||
      new Date(meeting.startTime) <= new Date()
    ) {
      throw new ConflictException({
        success: false,
        message:
          'Meeting is not upcoming (status must be scheduled with future start time)',
        error: { code: 'MEETING_NOT_UPCOMING', details: {} },
      });
    }
  }

  private async loadParticipants(meetingId: string): Promise<{
    internalParticipants: MeetingParticipantEntity[];
    externalParticipants: MeetingExternalParticipantEntity[];
  }> {
    const internalParticipants = await this.participantRepo.find({
      where: { meetingId },
    });
    const externalParticipants = await this.externalParticipantRepo.find({
      where: { meetingId },
    });
    return { internalParticipants, externalParticipants };
  }

  private dedupIds(ids: string[]): string[] {
    return [...new Set(ids.filter(Boolean))];
  }

  private async buildInvitationContent(
    meeting: MeetingEntity,
    dto: SendMeetingInvitationDto,
  ): Promise<string> {
    let content =
      'Bạn được mời tham dự cuộc họp: <b>' + meeting.title + '</b><br/>';
    content +=
      'Thời gian: ' +
      meeting.startTime.toISOString() +
      ' — ' +
      meeting.endTime.toISOString() +
      '<br/>';
    if (dto.includeAgenda) {
      const agendas = await this.agendaRepo.find({
        where: { meetingId: meeting.id },
        order: { agendaOrder: 'ASC' },
      });
      if (agendas.length > 0) {
        content += '<br/>Chương trình họp:<br/><ul>';
        for (const a of agendas) {
          content += '<li>' + a.title + '</li>';
        }
        content += '</ul>';
      }
    }
    if (dto.message) {
      content += '<br/>Lời nhắn: ' + dto.message;
    }
    return content;
  }

  private buildReminderContent(meeting: MeetingEntity): string {
    return (
      'Nhắc nhở: Cuộc họp <b>' +
      meeting.title +
      '</b> sẽ diễn ra vào lúc ' +
      meeting.startTime.toISOString() +
      '. Vui lòng tham dự đúng giờ.'
    );
  }

  private buildCancellationContent(
    meeting: MeetingEntity,
    reason: string,
  ): string {
    return (
      'Cuộc họp <b>' + meeting.title + '</b> đã bị hủy.<br/>Lý do: ' + reason
    );
  }

  private buildMinutesDistributionContent(
    meeting: MeetingEntity,
    minutes: MeetingMinutesEntity,
    message?: string,
  ): string {
    let content =
      'Biên bản cuộc họp <b>' + meeting.title + '</b> đã được ban hành.<br/>';
    content += 'Tiêu đề biên bản: ' + minutes.title + '<br/>';
    if (message) {
      content += '<br/>Lời nhắn: ' + message;
    }
    return content;
  }
}
