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
 *
 * [FIX 2026-08-09, Phần 4 — R11] false-positive tại ranh giới threshold: streak-confirm
 * (Phần 3, occupancy-persistence.service.ts) cần tích lũy presenceConfirmSeconds giây
 * TRƯỚC khi `first_presence_at` được ghi — nếu người bước vào ĐÚNG lúc threshold hết hạn,
 * `first_presence_at` vẫn NULL trong vài giây trong lúc streak đang tích lũy, khiến detect()
 * quét đúng lúc đó tạo nhầm case no-show dù người đã thực sự có mặt. Loại trừ bằng
 * NOT EXISTS occupancy event count>0 trong vòng ngưỡng gần nhất — cho streak-confirm ở
 * Phần 3 đủ thời gian xử lý trước khi detect() kết luận no-show.
 *
 * [FIX 2026-08-13, R14] Mốc guard đổi từ `presenceConfirmSeconds` (biến nghiệp vụ, người
 * dùng chỉnh được, có thể để rất nhỏ) sang hằng số cố định `RECONCILE_GRACE_SECONDS`.
 * Lý do: `OccupancyPersistenceService.reconcilePendingConfirmations()` (chạy TRƯỚC
 * detect() trong CÙNG lần cron mỗi phút — xem scheduler.service.ts) giờ ĐÃ đảm bảo
 * `room_booking_usages` luôn được tạo/cập nhật đúng (root cause thật của bug đêm nay,
 * KHÔNG phải do mốc thời gian của guard này — xem occupancy-persistence.service.ts) —
 * nên với ca ĐÃ đủ ngưỡng, `u.first_presence_at IS NULL` (điều kiện chính, dòng dưới) tự
 * nó đã đủ tin cậy, KHÔNG cần guard phụ nữa. Guard này giờ CHỈ còn phòng hờ 1 tình huống
 * hẹp: `reconcilePendingConfirmations()` lỗi transient RIÊNG cho đúng 1 booking ở đúng
 * tick đó (hàm có try/catch từng booking, 1 lỗi không dừng cả batch nhưng booking đó thật
 * sự chưa được xử lý) — tick sau (1 phút) sẽ tự sửa. Vì đây là vấn đề VẬN HÀNH (cron retry),
 * KHÔNG phải vấn đề NGHIỆP VỤ (ngưỡng xác nhận có mặt), mốc đệm PHẢI độc lập với
 * `presenceConfirmSeconds` — dùng lại biến đó chính là nguyên nhân gốc khiến guard "hết
 * hạn bảo vệ" quá sớm khi người dùng cấu hình ngưỡng nhỏ (ca thực tế đêm nay).
 */
@Injectable()
export class NoShowDetectionService {
  private readonly logger = new Logger(NoShowDetectionService.name);
  private static readonly DEFAULT_THRESHOLD_MINUTES = 15;
  // [FIX 2026-08-13, R14] Đệm cố định cho guard phụ — gấp đôi chu kỳ cron EVERY_MINUTE
  // (scheduler.service.ts), đủ để tick sau retry nếu reconcile lỗi transient ở tick này.
  // KHÔNG lấy từ NoShowConfigService — cố tình độc lập với ngưỡng nghiệp vụ người dùng cấu hình.
  private static readonly RECONCILE_GRACE_SECONDS = 120;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly noShowService: NoShowService,
  ) {}

  async detect(): Promise<{ scanned: number; created: number }> {
    const threshold = await this.readThreshold();

    const candidates = await this.dataSource.manager.query(
      `SELECT b.id AS booking_id, b.meeting_id, b.room_id
       FROM room_bookings b
       LEFT JOIN room_booking_usages u ON u.booking_id = b.id
       WHERE b.status IN ('approved','active')
         AND b.reserved_start_time + ($1::int * interval '1 minute') < now()
         AND u.first_presence_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM no_show_cases nc WHERE nc.booking_id = b.id)
         AND NOT EXISTS (
           SELECT 1 FROM room_events re
            WHERE re.room_id = b.room_id
              AND re.event_type = 'occupancy_detected'
              AND re.occupancy_count > 0
              AND re.event_time >= now() - ($2::int * interval '1 second')
         )`,
      [threshold, NoShowDetectionService.RECONCILE_GRACE_SECONDS],
    );

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
      const rows = await this.dataSource.manager.query(
        `SELECT config_value FROM system_configs WHERE config_key = 'no_show.threshold_minutes' LIMIT 1`,
      );
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
