import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NoShowService } from './no-show.service.js';

interface CandidateRow {
  booking_id: string;
  meeting_id: string;
  room_id: string;
}

/**
 * NoShowDetectionService (NSC-001) — quét booking quá ngưỡng chưa có presence → tạo no-show case.
 *
 * Gọi bởi @Cron checkNoShow (gated SCHEDULER_NO_SHOW_CHECK_ENABLED, default OFF).
 * Threshold đọc 1 lần/đợt (NC-2). SEC-03: bind threshold. detect() KHÔNG throw ra ngoài (RP-4).
 */
@Injectable()
export class NoShowDetectionService {
  private readonly logger = new Logger(NoShowDetectionService.name);
  private static readonly DEFAULT_THRESHOLD_MINUTES = 15;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly noShowService: NoShowService,
  ) {}

  async detect(): Promise<{ scanned: number; created: number }> {
    const threshold = await this.readThreshold();

    const candidates = (await this.dataSource.manager.query(
      `SELECT b.id AS booking_id, b.meeting_id, b.room_id
       FROM room_bookings b
       LEFT JOIN room_booking_usages u ON u.booking_id = b.id
       WHERE b.status IN ('approved','active')
         AND b.reserved_start_time + ($1::int * interval '1 minute') < now()
         AND u.first_presence_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM no_show_cases nc WHERE nc.booking_id = b.id)`,
      [threshold],
    )) as CandidateRow[];

    let created = 0;
    const detectedAt = new Date().toISOString();
    for (const c of candidates) {
      try {
        const r = await this.noShowService.create({
          bookingId: c.booking_id,
          meetingId: c.meeting_id,
          roomId: c.room_id,
          detectionStatus: 'risk',
          evidenceJson: { threshold, detectedAt },
        });
        if (r.created) created++;
      } catch (e) {
        // RP-4: lỗi 1 booking KHÔNG dừng cả batch.
        this.logger.error(
          `no-show create failed for booking ${c.booking_id}: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    }

    return { scanned: candidates.length, created };
  }

  /** Precedence (NC-2): system_configs[no_show.threshold_minutes] → env → default 15. */
  private async readThreshold(): Promise<number> {
    try {
      const rows = (await this.dataSource.manager.query(
        `SELECT config_value FROM system_configs WHERE config_key = 'no_show.threshold_minutes' LIMIT 1`,
      )) as Array<{ config_value: string | null }>;
      const raw = rows?.[0]?.config_value;
      if (raw != null) {
        const n = parseInt(raw, 10);
        if (Number.isInteger(n) && n > 0) return n;
      }
    } catch (e) {
      this.logger.warn(
        `read no-show threshold from system_configs failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
    return this.configService.get<number>(
      'NO_SHOW_THRESHOLD_MINUTES',
      NoShowDetectionService.DEFAULT_THRESHOLD_MINUTES,
    );
  }
}
