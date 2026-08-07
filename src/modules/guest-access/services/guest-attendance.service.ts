import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AttendanceEventEntity } from '../../attendance/entities/attendance-event.entity.js';
import { MeetingExternalParticipantEntity } from '../../meetings/entities/meeting-external-participant.entity.js';
import { GuestAccessCacheService } from './guest-access-cache.service.js';
import {
  GUEST_ATTENDANCE_EVENT_TYPE,
  GUEST_ATTENDANCE_SOURCE_TYPE,
} from '../constants/guest-access.constants.js';
import { GuestRequestContext } from '../types/guest-jwt-payload.type.js';

/**
 * GuestAttendanceService — ghi `attendance_events` cho khách (spec quyết
 * định #6, FR-GLA-038..040).
 *
 * `event_type` riêng (`guest_join`/`guest_leave`) — KHÔNG BAO GIỜ dùng
 * `check_in`/`check_out` — để KHÔNG lọt vào bất kỳ truy vấn hiện có nào đang
 * lọc theo 2 giá trị đó (timeline UC-99, fallback điểm danh UC-IMM-08).
 *
 * Best-effort: lỗi ghi KHÔNG được làm hỏng luồng đọc nội dung của khách.
 */
@Injectable()
export class GuestAttendanceService {
  private readonly logger = new Logger(GuestAttendanceService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: GuestAccessCacheService,
  ) {}

  /** Ghi đúng 1 lần `guest_join` cho mỗi phiên (`jti`) — chống ghi trùng khi gọi API nhiều lần. */
  async logJoinOnce(guest: GuestRequestContext): Promise<void> {
    try {
      const alreadyLogged = await this.cache.hasAttendanceLogged(guest.jti);
      if (alreadyLogged) return;

      await this.writeEvent(guest, GUEST_ATTENDANCE_EVENT_TYPE.JOIN);
      await this.cache.markAttendanceLogged(guest.jti);
    } catch (error) {
      this.logger.error(
        `Failed to log guest_join for ep=${guest.externalParticipantId}: ${(error as Error).message}`,
      );
    }
  }

  /** Best-effort — gọi khi phiên khách kết thúc (đóng tab/hết hạn/bị thu hồi). */
  async logLeave(guest: GuestRequestContext): Promise<void> {
    try {
      await this.writeEvent(guest, GUEST_ATTENDANCE_EVENT_TYPE.LEAVE);
    } catch (error) {
      this.logger.error(
        `Failed to log guest_leave for ep=${guest.externalParticipantId}: ${(error as Error).message}`,
      );
    }
  }

  private async writeEvent(
    guest: GuestRequestContext,
    eventType: string,
  ): Promise<void> {
    const externalParticipant = await this.dataSource
      .getRepository(MeetingExternalParticipantEntity)
      .findOne({ where: { id: guest.externalParticipantId } });

    await this.dataSource.getRepository(AttendanceEventEntity).save({
      meetingId: guest.meetingId,
      userId: null,
      eventType,
      eventTime: new Date(),
      sourceType: GUEST_ATTENDANCE_SOURCE_TYPE,
      metadataJson: {
        externalParticipantId: guest.externalParticipantId,
        fullName: externalParticipant?.fullName ?? null,
        organizationName: externalParticipant?.organizationName ?? null,
      },
    });
  }
}
