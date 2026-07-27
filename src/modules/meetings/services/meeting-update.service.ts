import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MeetingEntity, MeetingStatus } from '../entities/meeting.entity.js';
import { MeetingEventType } from '../entities/meeting-event.entity.js';
import { UpdateMeetingDto } from '../dto/update-meeting.dto.js';
import { UpdateMeetingResponseDto } from '../dto/update-meeting-response.dto.js';
import type { AuthUser } from './meetings.service.js';

/**
 * MeetingUpdateService — BE-03 PATCH /meetings/:meetingId.
 *
 * Pham vi CO Y HEP: chi title/description. Time/room/participants/agenda/
 * recording da co endpoint chuyen trach (xem spec §"Ngoai pham vi"). Tach
 * service rieng thay vi nhoi vao meetings.service.ts (da 5000+ dong, §15
 * CLAUDE.md).
 */
@Injectable()
export class MeetingUpdateService {
  constructor(private readonly dataSource: DataSource) {}

  async update(
    meetingId: string,
    dto: UpdateMeetingDto,
    authUser: AuthUser,
  ): Promise<UpdateMeetingResponseDto> {
    if (dto.title === undefined && dto.description === undefined) {
      throw new BadRequestException({
        success: false,
        message:
          'Phải cung cấp ít nhất một trong hai trường title/description.',
        error: { code: 'EMPTY_UPDATE_PAYLOAD', details: {} },
      });
    }

    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({ where: { id: meetingId } });

    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Cuộc họp không tồn tại hoặc đã bị xóa',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }

    const isOwner =
      meeting.organizerId === authUser.userId ||
      meeting.hostId === authUser.userId;
    if (!isOwner) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền chỉnh sửa cuộc họp này',
        error: {
          code: 'FORBIDDEN',
          details: {
            requiredPermission: 'meeting.update.own',
            isOrganizer: meeting.organizerId === authUser.userId,
            isHost: meeting.hostId === authUser.userId,
          },
        },
      });
    }

    if (
      meeting.status === MeetingStatus.CANCELLED ||
      meeting.status === MeetingStatus.COMPLETED
    ) {
      throw new ConflictException({
        success: false,
        message: 'Không thể chỉnh sửa cuộc họp đã hủy hoặc đã kết thúc.',
        error: {
          code: 'INVALID_MEETING_STATUS',
          details: { meetingId, currentStatus: meeting.status },
        },
      });
    }

    const newTitle = dto.title ?? meeting.title;
    const newDescription =
      dto.description !== undefined ? dto.description : meeting.description;

    const updatedAt = await this.dataSource.transaction(async (em) => {
      await em.query(
        `UPDATE meetings
         SET title = $1, description = $2, updated_by = $3, updated_at = NOW()
         WHERE id = $4`,
        [newTitle, newDescription, authUser.userId, meetingId],
      );

      await em.query(
        `INSERT INTO meeting_events (meeting_id, event_type, event_time,
          actor_user_id, source_type, description, old_value_json, new_value_json)
         VALUES ($1, $2, NOW(), $3, 'manual', $4, $5::jsonb, $6::jsonb)`,
        [
          meetingId,
          MeetingEventType.METADATA_UPDATED,
          authUser.userId,
          `Thông tin cuộc họp "${newTitle}" đã được cập nhật.`,
          JSON.stringify({
            title: meeting.title,
            description: meeting.description,
          }),
          JSON.stringify({ title: newTitle, description: newDescription }),
        ],
      );

      const rows = await em.query(
        `SELECT updated_at FROM meetings WHERE id = $1`,
        [meetingId],
      );
      return rows[0].updated_at as Date;
    });

    return new UpdateMeetingResponseDto({
      meetingId,
      title: newTitle,
      description: newDescription,
      updatedAt,
    });
  }
}
