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

/**
 * ZonePresenceTimelineService (ZPT-001 / UC-119) — timeline hiện diện theo khu vực.
 *
 * Mô hình dữ liệu là NHẬT KÝ BẮT GẶP (sighting log): camera IVSS bắn `zone_presence_events`
 * mỗi khi *thấy* một người trong khung hình (giá trị hợp lệ duy nhất là
 * `ZONE_PRESENCE_EVENT_TYPES` = `appear`/`disappear`/`count` — xem
 * `zones/constants/zone-presence-event-type.constant.ts`), KHÔNG bắn khi người đó rời khung.
 * Vì vậy service này KHÔNG thể (và không cố) ghép cặp "vào/ra" để tính thời lượng lưu lại —
 * nguồn dữ liệu không đủ thông tin cho việc đó. `enter`/`exit` là giá trị của
 * `gate_access_logs.direction` (một bảng khác, ngữ nghĩa khác: đi qua ranh giới cổng) —
 * không được dùng nhầm ở đây.
 *
 * 100% READ-ONLY, không persist gì thêm (DATA-01).
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
        sightingCount: null,
        message: NO_DATA_MESSAGE,
      };
    }

    const personDataAvailable = userId
      ? true
      : events.some((e) => e.userId !== null);

    return {
      events: this.toDto(events),
      personDataAvailable,
      sightingCount: userId ? events.length : null,
    };
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
