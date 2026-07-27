import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MeetingEntity } from '../entities/meeting.entity.js';
import {
  MeetingListQueryDto,
  MeetingListSortField,
} from '../dto/meeting-list-query.dto.js';
import { MeetingListItemDto } from '../dto/meeting-list-item.dto.js';

export interface MeetingListResult {
  data: MeetingListItemDto[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

// Allowlist tuong minh sortBy (DTO) -> column SQL that su. KHONG bao gio noi
// truc tiep gia tri tu client vao chuoi SQL (CLAUDE.md 14.3).
const SORT_COLUMN_MAP: Record<MeetingListSortField, string> = {
  created_at: 'meeting.created_at',
  start_time: 'meeting.start_time',
  title: 'meeting.title',
  status: 'meeting.status',
};

/**
 * MeetingListService — BE-02 GET /meetings (list, admin).
 *
 * Tach service rieng thay vi nhoi vao meetings.service.ts (da 5000+ dong,
 * §15 CLAUDE.md — module boundary).
 */
@Injectable()
export class MeetingListService {
  constructor(private readonly dataSource: DataSource) {}

  async list(query: MeetingListQueryDto): Promise<MeetingListResult> {
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: '"from" phai truoc hoac bang "to".',
      });
    }

    const qb = this.dataSource
      .getRepository(MeetingEntity)
      .createQueryBuilder('meeting')
      .leftJoin('meeting.organizer', 'organizer')
      .leftJoin('rooms', 'room', 'room.id = meeting.room_id')
      .where('meeting.deleted_at IS NULL');

    if (query.status) {
      qb.andWhere('meeting.status = :status', { status: query.status });
    }
    if (query.roomId) {
      qb.andWhere('meeting.room_id = :roomId', { roomId: query.roomId });
    }
    if (query.organizerId) {
      qb.andWhere('meeting.organizer_id = :organizerId', {
        organizerId: query.organizerId,
      });
    }
    if (query.from) {
      qb.andWhere('meeting.start_time >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('meeting.start_time <= :to', { to: query.to });
    }
    if (query.search) {
      qb.andWhere('meeting.title ILIKE :search', {
        search: `%${query.search}%`,
      });
    }

    const sortColumn = SORT_COLUMN_MAP[query.sortBy];
    qb.orderBy(sortColumn, query.sortOrder.toUpperCase() as 'ASC' | 'DESC');

    const page = query.page;
    const limit = query.limit;
    qb.skip((page - 1) * limit).take(limit);

    qb.select([
      'meeting.id',
      'meeting.meetingCode',
      'meeting.title',
      'meeting.status',
      'meeting.meetingType',
      'meeting.meetingMode',
      'meeting.startTime',
      'meeting.endTime',
      'meeting.roomId',
      'meeting.organizerId',
      'meeting.createdAt',
    ]);
    qb.addSelect('organizer.fullName', 'organizer_full_name');
    qb.addSelect('room.room_name', 'room_room_name');

    const [entities, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);

    const data = entities.entities.map((meeting, index) => {
      const raw = entities.raw[index] as {
        organizer_full_name: string | null;
        room_room_name: string | null;
      };
      return new MeetingListItemDto({
        id: meeting.id,
        meetingCode: meeting.meetingCode,
        title: meeting.title,
        status: meeting.status,
        meetingType: meeting.meetingType,
        meetingMode: meeting.meetingMode,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        roomId: meeting.roomId,
        roomName: raw?.room_room_name ?? null,
        organizerId: meeting.organizerId,
        organizerName: raw?.organizer_full_name ?? null,
        createdAt: meeting.createdAt,
      });
    });

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}
