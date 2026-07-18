import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

import { MeetingNotificationsService } from './services/meeting-notifications.service.js';
import { NotificationsService } from './notifications.service.js';

import { SendMeetingInvitationDto } from './dto/send-meeting-invitation.dto.js';
import { SendMeetingReminderDto } from './dto/send-meeting-reminder.dto.js';
import { ResendCancellationNotificationDto } from './dto/resend-cancellation-notification.dto.js';
import { DistributeMeetingMinutesDto } from './dto/distribute-meeting-minutes.dto.js';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto.js';

/**
 * NotificationsController — routes for module notifications.
 *
 * Meeting group (UC-143..146): prefix /meetings/:meetingId/...
 * Inbox group (UC-NOTI-01/02/03): prefix /notifications
 */
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class NotificationsController {
  constructor(
    private readonly meetingNotificationsService: MeetingNotificationsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ══════════════════════════════════════════
  //  UC-143: Send Meeting Invitation
  // ══════════════════════════════════════════

  @Post('meetings/:meetingId/invitations')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('notification.invite.send')
  async sendInvitation(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: SendMeetingInvitationDto,
    @CurrentUser() user: { userId: string },
  ) {
    const result = await this.meetingNotificationsService.sendMeetingInvitation(
      meetingId,
      { userId: user.userId },
      dto,
    );
    return { success: true, data: result };
  }

  // ══════════════════════════════════════════
  //  UC-144: Send Meeting Reminder
  // ══════════════════════════════════════════

  @Post('meetings/:meetingId/reminders')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('notification.reminder.send')
  async sendReminder(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: SendMeetingReminderDto,
    @CurrentUser() user: { userId: string },
  ) {
    const result = await this.meetingNotificationsService.sendMeetingReminder(
      meetingId,
      { userId: user.userId },
      dto,
    );
    return { success: true, data: result };
  }

  // ══════════════════════════════════════════
  //  UC-145: Resend Cancellation Notification
  // ══════════════════════════════════════════

  @Post('meetings/:meetingId/cancellation-notifications')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('notification.cancellation.send')
  async resendCancellation(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: ResendCancellationNotificationDto,
    @CurrentUser() user: { userId: string },
  ) {
    const result =
      await this.meetingNotificationsService.resendCancellationNotification(
        meetingId,
        { userId: user.userId },
        dto,
      );
    return { success: true, data: result };
  }

  // ══════════════════════════════════════════
  //  UC-146: Distribute Meeting Minutes
  // ══════════════════════════════════════════

  @Post('meetings/:meetingId/minutes/distributions')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('minutes.distribute')
  async distributeMinutes(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: DistributeMeetingMinutesDto,
    @CurrentUser() user: { userId: string },
  ) {
    const result =
      await this.meetingNotificationsService.distributeMeetingMinutes(
        meetingId,
        { userId: user.userId },
        dto,
      );
    return { success: true, data: result };
  }

  // ══════════════════════════════════════════
  //  Notification Inbox (list / detail — không tracking đã đọc)
  // ══════════════════════════════════════════

  @Get('notifications')
  @RequirePermissions('notification.read.self')
  async listMyNotifications(
    @CurrentUser() user: { userId: string },
    @Query() query: ListNotificationsQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const result = await this.notificationsService.listMyNotifications(
      user.userId,
      page,
      limit,
    );
    return { success: true, ...result };
  }

  @Get('notifications/:id')
  @RequirePermissions('notification.read.self')
  async getNotificationDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
  ) {
    const result = await this.notificationsService.getMyNotificationDetail(
      id,
      user.userId,
    );
    return { success: true, data: result };
  }
}
