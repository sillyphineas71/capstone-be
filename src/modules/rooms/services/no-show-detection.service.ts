import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NoShowService } from './no-show.service.js';

interface CandidateRow {
  booking_id: string;
  meeting_id: string;
  room_id: string;
}
interface ChannelRoomMapRow {
  config_json: Record<string, unknown> | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 *
 * [FIX 2026-08-15] R14 lọc `room_events` CHỈ theo `room_id` — không phân biệt đúng
 * booking đang xét, nên nhiễu/occupancy event CŨ (từ 1 booking KHÁC trước đó, CÙNG
 * phòng) trong 120s gần nhất vẫn chặn được no-show của booking hiện tại, dù phòng
 * trống thật trong đúng cửa sổ của booking đó — có thể chặn vĩnh viễn nếu nhiễu lặp
 * lại đều đặn dưới 120s/lần. Sửa: thêm `re.event_time >= b.reserved_start_time` —
 * tái dùng đúng pattern đã có ở `reconcilePendingConfirmations()`
 * (occupancy-persistence.service.ts) — chỉ tính occupancy event xảy ra SAU khi
 * booking đang xét đã bắt đầu, loại event của phiên/booking khác trước đó.
 *
 * [FIX 2026-08-21, Việc A] Phòng KHÔNG được gán channel camera thì KHÔNG xét no-show
 * (yêu cầu nghiệp vụ Harry). Nguồn "phòng có camera" DUY NHẤT xác nhận qua recon DB
 * thật là `system_configs['ivss.channel_room_map']` (config_json {channelId: room_uuid})
 * — đúng bảng/đúng key mà `ivss-occupancy-ingest.service.ts#resolveRoom()` dùng để route
 * sự kiện camera vào phòng, và cũng là nơi DUY NHẤT UI System Settings (màn "Channel Maps")
 * ghi vào (qua ChannelMapConfigController, PATCH /system-configurations/channel-maps).
 * `iot_devices.device_type='room_camera'` KHÔNG dùng làm nguồn — recon DB thật
 * (2026-08-21) cho thấy 2/3 phòng có record `iot_devices` loại này lại KHÔNG có trong
 * `ivss.channel_room_map` hiện hành (thiết bị đã đăng ký nhưng channel chưa/không còn
 * trỏ tới phòng đó) — dùng iot_devices sẽ include nhầm phòng không hề nhận được sự kiện
 * occupancy thật nào, làm hỏng đúng mục đích của fix này.
 * Đọc map lỗi (DB down) hoặc map rỗng (chưa phòng nào gán camera) → fail-safe: bỏ qua
 * CẢ lượt quét (KHÔNG throw ra cron), scanned=created=0 — tick sau (mỗi phút) tự đọc lại,
 * không cache/ghi nhớ vĩnh viễn.
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

    let cameraRoomIds: string[];
    try {
      cameraRoomIds = await this.getCameraRoomIds();
    } catch (e) {
      this.logger.error(
        `read camera-room map failed — skip toàn bộ lượt quét (fail-safe, tick sau tự retry): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      return { scanned: 0, created: 0 };
    }
    if (cameraRoomIds.length === 0) {
      return { scanned: 0, created: 0 };
    }

    const candidates = await this.dataSource.manager.query(
      `SELECT b.id AS booking_id, b.meeting_id, b.room_id
       FROM room_bookings b
       LEFT JOIN room_booking_usages u ON u.booking_id = b.id
       WHERE b.status IN ('approved','active')
         AND b.room_id = ANY($3::uuid[])
         AND b.reserved_start_time + ($1::int * interval '1 minute') < now()
         AND u.first_presence_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM no_show_cases nc WHERE nc.booking_id = b.id)
         AND NOT EXISTS (
           SELECT 1 FROM room_events re
            WHERE re.room_id = b.room_id
              AND re.event_type = 'occupancy_detected'
              AND re.occupancy_count > 0
              AND re.event_time >= b.reserved_start_time
              AND re.event_time >= now() - ($2::int * interval '1 second')
         )`,
      [
        threshold,
        NoShowDetectionService.RECONCILE_GRACE_SECONDS,
        cameraRoomIds,
      ],
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

  /**
   * Danh sách room_id "có camera" — DUY NHẤT nguồn `ivss.channel_room_map` (xem header,
   * Việc A). Lỗi đọc DB được ĐỂ TRỒI lên `detect()` (không catch ở đây) để `detect()` áp
   * fail-safe skip cả lượt quét, thay vì âm thầm coi "không phòng nào có camera".
   */
  private async getCameraRoomIds(): Promise<string[]> {
    const rows: ChannelRoomMapRow[] = await this.dataSource.manager.query(
      `SELECT config_json FROM system_configs
       WHERE config_key = 'ivss.channel_room_map' AND is_active = true LIMIT 1`,
    );
    const raw = rows[0]?.config_json;
    const ids = new Set<string>();
    if (raw && typeof raw === 'object') {
      for (const v of Object.values(raw)) {
        if (typeof v === 'string' && UUID_RE.test(v)) ids.add(v);
      }
    }
    return [...ids];
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
