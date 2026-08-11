import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { NoShowConfigService } from '../../rooms/services/no-show-config.service.js';

export interface PersistOccupancyInput {
  roomId: string;
  meetingId: string | null;
  occupancyCount: number;
  confidence: number | null;
  eventTime: Date;
}

interface BookingRow {
  booking_id: string;
  meeting_id: string;
  reserved_start_time: Date | string;
  reserved_end_time: Date | string;
}

interface UsageRow {
  first_presence_at: Date | string | null;
}

interface StreakRow {
  streak_start: Date | string | null;
}

/**
 * OccupancyPersistenceService (OCC-001 refactor / IVSS-OCC-001) — ghi occupancy DÙNG CHUNG.
 *
 * Tách từ OccupancyIngestService (phần transaction + WS) để **cả room-camera lẫn A-OCC IVSS**
 * cùng gọi — single source, KHÔNG nhân bản. Caller tự lo auth + raw `iot_device_events`
 * (mỗi nguồn resolve device.id khác nhau); service này chỉ persist mức room.
 *
 * LOCKED-A: validate `occupancyCount` 0..MAX **TRONG persist** (đầu hàm, trước transaction) →
 * mọi caller được bảo vệ; room-camera giữ ném 400 (vị trí ném trước startTransaction không đổi),
 * A-OCC bọc try/catch → ack 200.
 *
 * [FIX 2026-08-09, Phần 3] Streak-based presence confirmation — trước đây 1 event nhiễu
 * (count>0 thoáng qua) kích hoạt NGAY LẬP TỨC first_presence_at + usage_status='in_use' +
 * rooms.current_status='occupied' cùng lúc, không có debounce. Nay CHỈ khi booking chưa
 * từng được xác nhận có mặt (`first_presence_at IS NULL`), phải tích lũy đủ
 * `presenceConfirmSeconds` giây liên tục (chấp nhận gián đoạn ngắn hơn
 * `presenceNoiseToleranceSeconds` là nhiễu cảm biến, không phải chấm dứt) mới xác nhận —
 * và CẢ 3 side-effect (first_presence_at/usage_status/rooms.current_status) đồng bộ theo
 * cùng 1 lần xác nhận đó, tránh trạng thái "phòng occupied nhưng chưa ai được coi là có mặt".
 * Booking ĐÃ xác nhận trước đó (`first_presence_at` đã có giá trị) giữ NGUYÊN hành vi cũ.
 */
@Injectable()
export class OccupancyPersistenceService {
  private readonly logger = new Logger(OccupancyPersistenceService.name);
  private static readonly MAX_OCCUPANCY = 1000; // chặn số vô lý.

  constructor(
    private readonly dataSource: DataSource,
    private readonly websocketService: WebsocketService,
    private readonly noShowConfigService: NoShowConfigService,
  ) {}

  /**
   * Persist occupancy: room_events + (nếu booking) presence_snapshots + room_booking_usages
   * (streak-gated nếu chưa confirm) + rooms.current_status trong transaction; sau đó WS
   * best-effort.
   * @returns { statusChanged } — true nếu rooms.current_status THẬT SỰ đổi sang occupied.
   */
  async persist(
    input: PersistOccupancyInput,
  ): Promise<{ statusChanged: boolean }> {
    const { roomId, meetingId, occupancyCount, confidence, eventTime } = input;

    // LOCKED-A: validate count TRƯỚC transaction (giữ vị trí ném trước startTransaction).
    if (
      !Number.isInteger(occupancyCount) ||
      occupancyCount < 0 ||
      occupancyCount > OccupancyPersistenceService.MAX_OCCUPANCY
    ) {
      throw new BadRequestException({
        code: 'INVALID_OCCUPANCY_PAYLOAD',
        message: 'occupancyCount must be an integer between 0 and 1000.',
      });
    }

    // Đọc 1 lần/request (NC-2 pattern) — KHÔNG đọc lại nhiều lần trong cùng persist().
    const { presenceConfirmSeconds, presenceNoiseToleranceSeconds } =
      await this.noShowConfigService.getValues();

    let statusChangedToOccupied = false;
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // a. room_events (LUÔN)
      await queryRunner.query(
        `INSERT INTO room_events
           (room_id, meeting_id, event_type, event_time, occupancy_count, confidence_score, source_type)
         VALUES ($1,$2,$3,$4,$5,$6,'camera')`,
        [
          roomId,
          meetingId,
          'occupancy_detected',
          eventTime,
          occupancyCount,
          confidence,
        ],
      );

      // b. booking active của room tại eventTime
      // [FIX 2026-08-09] reserved_end_time đổi inclusive (>=) → exclusive (>): 2 booking
      // liền kề không có khoảng trống (A kết thúc đúng lúc B bắt đầu) — event ĐÚNG giây
      // chuyển giao trước đây khớp CẢ HAI (do >= 2 đầu), ORDER BY reserved_start_time ASC
      // luôn chọn nhầm booking SẮP KẾT THÚC (A) thay vì booking SẮP BẮT ĐẦU (B). Biên
      // reserved_start_time <= vẫn giữ inclusive — event đúng giây bắt đầu PHẢI thuộc
      // booking đó, không phải booking liền trước.
      // [FIX Phần 3] SELECT thêm reserved_start_time/reserved_end_time — dùng làm bound
      // cho query streak bên dưới (R3.2: cần SELECT thêm, không có sẵn từ trước).
      const bookingRows = (await queryRunner.query(
        `SELECT id AS booking_id, meeting_id, reserved_start_time, reserved_end_time
           FROM room_bookings
           WHERE room_id = $1 AND reserved_start_time <= $2 AND reserved_end_time > $2
             AND status IN ('approved','active')
           ORDER BY reserved_start_time ASC LIMIT 1`,
        [roomId, eventTime],
      )) as BookingRow[];
      const booking = bookingRows?.[0];

      // true nếu rooms.current_status ĐƯỢC PHÉP flip sang occupied ở bước c bên dưới —
      // mặc định true (không có booking → giữ nguyên hành vi cũ, không gate theo streak).
      let allowRoomStatusFlip = true;

      if (booking) {
        // presence_snapshots (meeting_id NOT NULL → cần booking.meeting_id) — GIỮ NGUYÊN,
        // ghi mọi event như cũ, không gate theo streak.
        await queryRunner.query(
          `INSERT INTO presence_snapshots
             (meeting_id, room_id, occupancy_count, presence_status, snapshot_time, source_type, confidence_score)
           VALUES ($1,$2,$3,'present',$4,'camera',$5)`,
          [booking.meeting_id, roomId, occupancyCount, eventTime, confidence],
        );

        const usageRows = (await queryRunner.query(
          `SELECT first_presence_at FROM room_booking_usages WHERE booking_id = $1`,
          [booking.booking_id],
        )) as UsageRow[];
        const alreadyConfirmed = usageRows?.[0]?.first_presence_at != null;

        if (alreadyConfirmed) {
          // Booking ĐÃ xác nhận có mặt từ trước — GIỮ NGUYÊN hành vi cũ hoàn toàn,
          // KHÔNG áp lại streak-check.
          await queryRunner.query(
            `UPDATE room_booking_usages
             SET first_presence_at = COALESCE(first_presence_at, $2),
                 last_presence_at = $2,
                 occupancy_source = 'camera',
                 usage_status = CASE
                   WHEN usage_status = 'not_started' AND $3 > 0 THEN 'in_use'
                   ELSE usage_status END
             WHERE booking_id = $1`,
            [booking.booking_id, eventTime, occupancyCount],
          );
          // allowRoomStatusFlip giữ true (mặc định) — mirror đúng logic cũ.
        } else if (occupancyCount > 0) {
          // Chưa từng xác nhận có mặt + event hiện tại count>0 → tính streak, bound
          // TRONG ĐÚNG cửa sổ booking đã resolve (chống leak sang booking liền kề).
          const streakRows = (await queryRunner.query(
            `WITH positive_events AS (
               SELECT event_time
                 FROM room_events
                WHERE room_id = $1
                  AND event_type = 'occupancy_detected'
                  AND occupancy_count > 0
                  AND event_time >= $2
                  AND event_time <= $3
                  AND event_time <= $4
                ORDER BY event_time DESC
             ),
             -- Postgres KHÔNG cho lồng window function trực tiếp (LEAD trong SUM) →
             -- tách gap_to_prev ra 1 CTE riêng trước khi SUM ở CTE kế tiếp.
             with_gap AS (
               SELECT event_time,
                      event_time - LEAD(event_time) OVER (ORDER BY event_time DESC)
                        AS gap_to_prev
                 FROM positive_events
             ),
             -- ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING (LOẠI TRỪ dòng hiện tại):
             -- gap_to_prev của 1 dòng mô tả khoảng cách TỪ dòng đó TỚI dòng cũ hơn liền kề —
             -- nếu vượt tolerance, đó là ranh giới NGAY SAU dòng đó (thuộc về dòng CŨ HƠN bị
             -- loại, KHÔNG PHẢI chính dòng này). Dùng SUM bao gồm cả dòng hiện tại (thiếu
             -- ROWS EXCLUSIVE) sẽ gán nhầm break cho chính dòng vừa tạo ra khoảng cách đó
             -- (đã bắt lỗi này bằng kiểm chứng thực nghiệm trên Postgres thật trước khi áp
             -- vào đây — xem test_streak_sql.sql).
             grouped AS (
               SELECT event_time,
                      COALESCE(
                        SUM(CASE WHEN gap_to_prev > ($5::int * interval '1 second') THEN 1 ELSE 0 END)
                          OVER (
                            ORDER BY event_time DESC
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                          ),
                        0
                      ) AS break_group
                 FROM with_gap
             )
             SELECT MIN(event_time) AS streak_start
               FROM grouped
              WHERE break_group = 0`,
            [
              roomId,
              booking.reserved_start_time,
              booking.reserved_end_time,
              eventTime,
              presenceNoiseToleranceSeconds,
            ],
          )) as StreakRow[];
          const streakStart = streakRows?.[0]?.streak_start;

          const streakDurationMs = streakStart
            ? eventTime.getTime() - new Date(streakStart).getTime()
            : -1;
          const confirmedNow =
            streakDurationMs >= presenceConfirmSeconds * 1000;

          if (confirmedNow) {
            await queryRunner.query(
              `UPDATE room_booking_usages
               SET first_presence_at = $2,
                   last_presence_at = $3,
                   occupancy_source = 'camera',
                   usage_status = CASE
                     WHEN usage_status = 'not_started' THEN 'in_use'
                     ELSE usage_status END
               WHERE booking_id = $1`,
              [booking.booking_id, streakStart, eventTime],
            );
          } else {
            // Chưa đủ ngưỡng: KHÔNG update gì cả — lần event tiếp theo tự tính lại streak.
            allowRoomStatusFlip = false;
          }
        } else {
          // booking chưa xác nhận + occupancyCount == 0: KHÔNG chạm room_booking_usages
          // (tránh bug cũ: count=0 vẫn set first_presence_at qua COALESCE).
          allowRoomStatusFlip = false;
        }
      }

      // c. status: count>0 → occupied (count==0 KHÔNG đổi — D-4). Gate theo
      //    allowRoomStatusFlip (Phần 3) — chỉ flip khi: không có booking (hành vi cũ),
      //    booking đã xác nhận từ trước, hoặc vừa được xác nhận bởi streak ở trên.
      //    RETURNING id để biết status THẬT SỰ đổi → emit room.status.updated chỉ khi đổi.
      if (occupancyCount > 0 && allowRoomStatusFlip) {
        const updateResult: unknown = await queryRunner.query(
          `UPDATE rooms SET current_status = 'occupied'
           WHERE id = $1 AND current_status IS DISTINCT FROM 'occupied'
           RETURNING id`,
          [roomId],
        );
        // Postgres UPDATE...RETURNING qua TypeORM trả [rows, affectedCount];
        // chuẩn hoá lấy rows để emit CHỈ khi thật sự có 1 row đổi.
        const rows =
          Array.isArray(updateResult) && Array.isArray(updateResult[0])
            ? updateResult[0]
            : updateResult;
        statusChangedToOccupied = Array.isArray(rows) && rows.length > 0;
      }

      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `occupancy persist failed for room ${roomId}: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      throw e;
    } finally {
      await queryRunner.release();
    }

    // WS best-effort (lỗi WS KHÔNG ảnh hưởng DB/kết quả)
    try {
      this.websocketService.emitToRoom(
        `room:${roomId}`,
        'room.occupancy.updated',
        { roomId, occupancyCount, timestamp: eventTime.toISOString() },
      );
      if (statusChangedToOccupied) {
        this.websocketService.emitToRoom(
          `room:${roomId}`,
          'room.status.updated',
          { roomId, status: 'occupied', timestamp: eventTime.toISOString() },
        );
      }
    } catch (e) {
      this.logger.warn(
        `WS emit room.occupancy.updated failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }

    return { statusChanged: statusChangedToOccupied };
  }
}
