import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository, type FindOptionsWhere } from 'typeorm';
import { ZoneEntity } from '../../zones/entities/zone.entity.js';
import { ZonePresenceEventEntity } from '../../zones/entities/zone-presence-event.entity.js';
import type {
  TimelineEventDto,
  ZoneTimelineResponseDto,
} from '../dto/zone-timeline-response.dto.js';

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000; // 31 ngày (spec §2.5)
const NO_DATA_MESSAGE =
  'Không có dữ liệu hiện diện trong khoảng thời gian này.';

interface PairResult {
  totalDurationSeconds: number;
  ongoing: boolean;
}

/**
 * ZonePresenceTimelineService (ZPT-001 / UC-119) — timeline + tổng thời gian lưu lại theo cá
 * nhân (BR1). 100% READ-ONLY, tính ghép cặp TẠM trong request — KHÔNG persist (DATA-01).
 */
@Injectable()
export class ZonePresenceTimelineService {
  constructor(
    @InjectRepository(ZoneEntity)
    private readonly zoneRepo: Repository<ZoneEntity>,
    @InjectRepository(ZonePresenceEventEntity)
    private readonly presenceRepo: Repository<ZonePresenceEventEntity>,
  ) {}

  async getTimeline(
    zoneId: string,
    from: Date,
    to: Date,
    userId?: string,
  ): Promise<ZoneTimelineResponseDto> {
    const zone = await this.zoneRepo.findOne({
      where: { id: zoneId, deletedAt: IsNull() },
    });
    if (!zone) {
      throw new NotFoundException({
        code: 'ZONE_NOT_FOUND',
        message: 'Không tìm thấy khu vực',
      });
    }

    this.validateRange(from, to);

    const where: FindOptionsWhere<ZonePresenceEventEntity> = {
      zoneId,
      eventTime: Between(from, to),
    };
    if (userId) where.userId = userId;

    const events = await this.presenceRepo.find({
      where,
      order: { eventTime: 'ASC' },
    });

    if (events.length === 0) {
      return {
        events: [],
        personDataAvailable: null,
        totalDurationSeconds: null,
        ongoing: false,
        message: NO_DATA_MESSAGE,
      };
    }

    const personDataAvailable = userId
      ? true
      : events.some((e) => e.userId !== null);

    if (userId) {
      const { totalDurationSeconds, ongoing } = this.pairEnterExit(events);
      return {
        events: this.toDto(events),
        personDataAvailable,
        totalDurationSeconds,
        ongoing,
      };
    }

    return {
      events: this.toDto(events),
      personDataAvailable,
      totalDurationSeconds: null,
      ongoing: false,
    };
  }

  /**
   * pairEnterExit (spec §2.3) — FIFO tuần tự (input đã ORDER BY eventTime ASC): `enter` mới
   * GHI ĐÈ `pendingEnter` cũ chưa đóng (chỉ 1 phiên đang mở tại 1 thời điểm); `exit` khi CÓ
   * `pendingEnter` → cộng dồn; `enter` cuối chưa có `exit` → `ongoing=true`, KHÔNG cộng tổng.
   */
  private pairEnterExit(events: ZonePresenceEventEntity[]): PairResult {
    let pendingEnter: Date | null = null;
    let totalDurationSeconds = 0;

    for (const event of events) {
      if (event.eventType === 'appear') {
        pendingEnter = event.eventTime;
      } else if (event.eventType === 'disappear' && pendingEnter) {
        totalDurationSeconds +=
          (event.eventTime.getTime() - pendingEnter.getTime()) / 1000;
        pendingEnter = null;
      }
    }

    return { totalDurationSeconds, ongoing: pendingEnter !== null };
  }

  private validateRange(from: Date, to: Date): void {
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw new BadRequestException({
        code: 'INVALID_TIMELINE_RANGE',
        message: 'Khoảng thời gian tối đa 31 ngày',
      });
    }
  }

  private toDto(events: ZonePresenceEventEntity[]): TimelineEventDto[] {
    return events.map((e) => ({
      eventTime: e.eventTime.toISOString(),
      eventType: e.eventType,
      occupancyCount: e.occupancyCount,
      userId: e.userId,
    }));
  }
}
