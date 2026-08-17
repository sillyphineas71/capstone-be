import { Injectable, Logger } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../../meetings/entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../../meetings/entities/meeting-external-participant.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { SchedulingService } from '../../scheduling/services/scheduling.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { buildRoomRemovedEmail } from '../../mail/templates/builders.js';

const MAX_SUGGESTED_ROOMS = 3;

/**
 * RoomDeleteNotificationProcessor (UC-ROOM-03) — xu ly bat dong bo SAU khi
 * phong hop da bi xoa: goi y phong thay the (scheduling/room-suggestions) +
 * gui email cho host/organizer VA direct manager cua tung meeting bi anh
 * huong (2026-08-16 — meeting o day CHI con la DRAFT/PENDING_APPROVAL, vi
 * cuoc hop da SCHEDULED gio chan xoa phong tu RoomsService.deleteRoom(), xem
 * EX2 moi trong spec).
 *
 * KHONG duoc await tu request handler chinh — chay "best-effort" sau khi
 * response DELETE da tra ve (NFR-002/OOS-005 cua spec).
 * Loi 1 meeting KHONG duoc lam hong ca job (FR-027) — try/catch per-meeting.
 */
@Injectable()
export class RoomDeleteNotificationProcessor {
  private readonly logger = new Logger(RoomDeleteNotificationProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly schedulingService: SchedulingService,
    private readonly notificationsService: NotificationsService,
    private readonly backgroundJobsService: BackgroundJobsService,
  ) {}

  async process(jobId: string, affectedMeetingIds: string[]): Promise<void> {
    await this.backgroundJobsService.markRunning(jobId);

    let successCount = 0;
    const failedMeetingIds: string[] = [];

    for (const meetingId of affectedMeetingIds) {
      try {
        await this.processOneMeeting(meetingId);
        successCount++;
      } catch (err) {
        failedMeetingIds.push(meetingId);
        this.logger.error(
          `[RoomDeleteNotify] Failed to process meeting ${meetingId}: ${
            err instanceof Error ? err.message : 'Unknown error'
          }`,
        );
      }
    }

    // FR-027: loi tung phan KHONG danh dau job 'failed' — van 'completed'
    // voi outputJson ghi ro danh sach that bai.
    await this.backgroundJobsService.markCompleted(jobId, {
      successCount,
      failedMeetingIds,
    });
  }

  private async processOneMeeting(meetingId: string): Promise<void> {
    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({ where: { id: meetingId } });
    if (!meeting) {
      // Meeting co the da bi xoa/huy giua chung — bo qua, khong coi la loi.
      return;
    }

    const attendeeCount = await this.getAttendeeCount(meetingId);
    const suggestedRooms = await this.getSuggestedRooms(
      attendeeCount,
      meeting.startTime,
      meeting.endTime,
    );

    const recipients = await this.resolveRecipients(meeting);
    if (recipients.length === 0) {
      // Khong co ai co email de gui — coi nhu khong the thong bao, khong throw
      // (khong phai loi he thong, chi la thieu du lieu lien lac).
      this.logger.warn(
        `[RoomDeleteNotify] Meeting ${meetingId}: khong co nguoi nhan hop le (host/manager thieu email), bo qua gui thong bao.`,
      );
      return;
    }

    const isPendingApproval = meeting.status === MeetingStatus.PENDING_APPROVAL;
    const suggestionsText =
      suggestedRooms.length > 0
        ? suggestedRooms
            .map(
              (r) => `- ${r.roomName} (${r.roomCode}), sức chứa ${r.capacity}`,
            )
            .join('\n')
        : 'Hiện chưa tìm được phòng thay thế phù hợp trong cùng khung giờ.';
    const pendingApprovalNote = isPendingApproval
      ? '\n\nCuộc họp này đang chờ phê duyệt và sẽ KHÔNG thể được duyệt cho đến khi người tổ chức chọn lại phòng và gửi lại yêu cầu.'
      : '';

    await this.notificationsService.enqueueEmailNotification({
      notificationType: NotificationType.MEETING_ROOM_REMOVED,
      channel: NotificationChannel.EMAIL,
      subject: `Phòng họp cho cuộc họp "${meeting.title}" đã bị gỡ bỏ`,
      content: `Phòng họp trước đây của cuộc họp "${meeting.title}" đã bị quản trị viên xóa khỏi hệ thống. Vui lòng chọn lại địa điểm mới.${pendingApprovalNote}\n\nGợi ý phòng thay thế:\n${suggestionsText}`,
      emailHtml: buildRoomRemovedEmail({
        meetingTitle: meeting.title,
        suggestedRooms,
        isPendingApproval,
      }),
      toEmails: recipients.map((u) => u.email!),
      relatedEntityType: 'meeting',
      relatedEntityId: meetingId,
      payloadJson: { suggestedRooms },
    });
  }

  /**
   * Nguoi nhan thong bao "phong bi xoa" (2026-08-16): host/organizer cua
   * meeting + direct manager cua tung nguoi do (UserEntity.directManagerId) —
   * de manager biet va KHONG the duyet yeu cau tro phong da mat. Dedupe theo
   * id, chi giu nguoi co email.
   */
  private async resolveRecipients(
    meeting: MeetingEntity,
  ): Promise<UserEntity[]> {
    const primaryIds = Array.from(
      new Set([meeting.organizerId, meeting.hostId].filter(Boolean)),
    ) as string[];
    if (primaryIds.length === 0) return [];

    const userRepo = this.dataSource.getRepository(UserEntity);
    const primaryUsers = await userRepo.find({
      where: { id: In(primaryIds) },
    });

    const managerIds = Array.from(
      new Set(
        primaryUsers.map((u) => u.directManagerId).filter(Boolean),
      ),
    ) as string[];
    const managers = managerIds.length
      ? await userRepo.find({ where: { id: In(managerIds) } })
      : [];

    const byId = new Map<string, UserEntity>();
    for (const u of [...primaryUsers, ...managers]) {
      if (u.email) byId.set(u.id, u);
    }
    return Array.from(byId.values());
  }

  private async getAttendeeCount(meetingId: string): Promise<number> {
    const [internalCount, externalCount] = await Promise.all([
      this.dataSource
        .getRepository(MeetingParticipantEntity)
        .count({ where: { meetingId } }),
      this.dataSource
        .getRepository(MeetingExternalParticipantEntity)
        .count({ where: { meetingId } }),
    ]);
    return Math.max(1, internalCount + externalCount);
  }

  private async getSuggestedRooms(
    attendeeCount: number,
    startTime: Date,
    endTime: Date,
  ): Promise<
    { roomId: string; roomCode: string; roomName: string; capacity: number }[]
  > {
    try {
      const { data } = await this.schedulingService.getRoomSuggestions({
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        attendeeCount,
      });
      return data.slice(0, MAX_SUGGESTED_ROOMS).map((r) => ({
        roomId: r.roomId,
        roomCode: r.roomCode,
        roomName: r.roomName,
        capacity: r.capacity,
      }));
    } catch (err) {
      // FR-015: 0 goi y van gui duoc — khong de loi validateTimeRange (vd startTime
      // vua qua khu do race condition) lam hong toan bo notification cho meeting nay.
      this.logger.warn(
        `[RoomDeleteNotify] Khong lay duoc goi y phong (startTime=${startTime.toISOString()}): ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
      );
      return [];
    }
  }
}
