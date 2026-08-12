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
 * `presenceConfirmSeconds` giây liên tục mới xác nhận — và CẢ 3 side-effect
 * (first_presence_at/usage_status/rooms.current_status) đồng bộ theo cùng 1 lần xác nhận
 * đó, tránh trạng thái "phòng occupied nhưng chưa ai được coi là có mặt". Booking ĐÃ xác
 * nhận trước đó (`first_presence_at` đã có giá trị) giữ NGUYÊN hành vi cũ.
 *
 * [FIX 2026-08-13, R12] Đổi hẳn thuật toán tính streak — bản cũ giả định cảm biến báo
 * ĐỊNH KỲ (coi im lặng > `presenceNoiseToleranceSeconds` là dấu hiệu đã rời đi, tính cụm
 * event gần nhau). Thực tế cảm biến camera đang dùng là loại **báo khi CHUYỂN TRẠNG THÁI**
 * (chỉ gửi 1 lần lúc vào khung + 1 lần lúc ra khung, KHÔNG gửi liên tục khi đứng yên) — với
 * loại cảm biến này, im lặng là BÌNH THƯỜNG (vẫn đang có mặt), không phải dấu hiệu rời đi.
 * Xác nhận qua thực tế: đứng liên tục 40s trong khung vẫn bị tính no-show vì thuật toán cũ
 * không có event thứ 2 nào để tính lại streak.
 *
 * Mô hình mới: hiện diện được coi là LIÊN TỤC kể từ event dương (`occupancy_count>0`) ĐẦU
 * TIÊN sau lần "rời đi thật" gần nhất — "rời đi thật" = 1 event `occupancy_count=0` mà
 * KHÔNG có event dương nào theo sau trong vòng `presenceNoiseToleranceSeconds` giây (loại
 * trừ nhiễu cảm biến thoáng qua, vd đứng sát mép khung hình). Xem `computeStreakStart()`.
 * `presenceConfirmSeconds` vẫn giữ nguyên ý nghĩa chống lách (Case A — vào rồi ra ngay):
 * event `count=0` thật đến sớm trước khi đủ ngưỡng vẫn cắt streak về 0 như cũ.
 *
 * [FIX 2026-08-13, R12 phần 2] Việc tính streak TRƯỚC ĐÂY chỉ chạy khi có event MỚI tới
 * (bên trong `persist()`) — với cảm biến chỉ báo 1 lần lúc vào, không có event thứ 2 nào
 * để kích hoạt tính lại streak dù bao nhiêu giây trôi qua thật ngoài đời. `reconcilePendingConfirmations()`
 * bù cho khoảng trống này: được cron gọi định kỳ (KHÔNG phụ thuộc có event mới hay không),
 * tính streak tới thời điểm `now()` cho mọi booking chưa xác nhận có mặt.
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
          const upperBound =
            eventTime < new Date(booking.reserved_end_time)
              ? eventTime
              : new Date(booking.reserved_end_time);
          const streakStart = await this.computeStreakStart(
            queryRunner,
            roomId,
            new Date(booking.reserved_start_time),
            upperBound,
            presenceNoiseToleranceSeconds,
          );

          const streakDurationMs = streakStart
            ? eventTime.getTime() - streakStart.getTime()
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

  /**
   * [FIX 2026-08-13, R12] Tính thời điểm bắt đầu chuỗi hiện diện liên tục hiện tại, trong
   * cửa sổ [boundStart, boundEnd]. "Liên tục" = kể từ event dương (`occupancy_count>0`) đầu
   * tiên SAU lần "rời đi thật" gần nhất — "rời đi thật" là 1 event `occupancy_count=0`
   * KHÔNG có event dương nào theo sau trong vòng `noiseToleranceSeconds` giây (loại trừ
   * nhiễu cảm biến thoáng qua). Không có event dương nào trong cửa sổ → trả `null`.
   *
   * Dùng chung cho cả 2 nơi: persist() (boundEnd = eventTime của event vừa nhận) và
   * reconcilePendingConfirmations() (boundEnd = now(), không phụ thuộc có event mới hay
   * không) — 1 nguồn tính toán DUY NHẤT, tránh 2 công thức lệch nhau.
   */
  private async computeStreakStart(
    executor: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    roomId: string,
    boundStart: Date,
    boundEnd: Date,
    noiseToleranceSeconds: number,
  ): Promise<Date | null> {
    const rows = (await executor.query(
      `WITH zero_events AS (
         SELECT event_time
           FROM room_events
          WHERE room_id = $1
            AND event_type = 'occupancy_detected'
            AND occupancy_count = 0
            AND event_time >= $2
            AND event_time <= $3
       ),
       -- "Rời đi thật": event=0 KHÔNG có event dương nào theo sau trong vòng tolerance
       -- giây (loại nhiễu cảm biến — vd đứng sát mép khung hình thoáng bị mất dấu).
       real_departures AS (
         SELECT z.event_time
           FROM zero_events z
          WHERE NOT EXISTS (
            SELECT 1 FROM room_events p
             WHERE p.room_id = $1
               AND p.event_type = 'occupancy_detected'
               AND p.occupancy_count > 0
               AND p.event_time > z.event_time
               AND p.event_time <= z.event_time + ($4::int * interval '1 second')
          )
       ),
       last_departure AS (
         SELECT MAX(event_time) AS departed_at FROM real_departures
       )
       SELECT MIN(e.event_time) AS streak_start
         FROM room_events e, last_departure d
        WHERE e.room_id = $1
          AND e.event_type = 'occupancy_detected'
          AND e.occupancy_count > 0
          AND e.event_time >= $2
          AND e.event_time <= $3
          AND (d.departed_at IS NULL OR e.event_time > d.departed_at)`,
      [roomId, boundStart, boundEnd, noiseToleranceSeconds],
    )) as Array<{ streak_start: Date | string | null }>;
    const streakStart = rows?.[0]?.streak_start;
    return streakStart ? new Date(streakStart) : null;
  }

  /**
   * [FIX 2026-08-13, R12 phần 2] Xác nhận có mặt theo ĐỒNG HỒ THỰC — KHÔNG chờ event mới.
   *
   * Bù lỗ hổng: `persist()` chỉ tính lại streak khi có event MỚI tới. Cảm biến báo-khi-
   * chuyển-trạng-thái (1 lần lúc vào, im lặng khi đứng yên, 1 lần lúc ra) có thể không bao
   * giờ gửi event thứ 2 — nếu vậy `persist()` không còn cơ hội nào để tự xác nhận đủ
   * `presenceConfirmSeconds` giây, dù người vẫn đang đứng trong phòng thật.
   *
   * Gọi định kỳ bởi cron `no-show-check` (SchedulerService.checkNoShow, TRƯỚC
   * NoShowDetectionService.detect() trong cùng lần chạy) — mỗi booking chưa xác nhận có
   * mặt, có ít nhất 1 event dương, được tính lại streak tới `now()`; đủ ngưỡng thì xác nhận
   * NGAY, không cần đợi event mới. Idempotent (`WHERE first_presence_at IS NULL` trong
   * UPDATE) — an toàn nếu chạy đồng thời với persist() của 1 event mới vừa tới.
   */
  async reconcilePendingConfirmations(): Promise<{
    scanned: number;
    confirmed: number;
  }> {
    const { presenceConfirmSeconds, presenceNoiseToleranceSeconds } =
      await this.noShowConfigService.getValues();
    const now = new Date();

    const candidates: Array<{
      booking_id: string;
      room_id: string;
      reserved_start_time: Date | string;
      reserved_end_time: Date | string;
    }> = await this.dataSource.manager.query(
      `SELECT b.id AS booking_id, b.room_id, b.reserved_start_time, b.reserved_end_time
         FROM room_bookings b
         JOIN room_booking_usages u ON u.booking_id = b.id
        WHERE b.status IN ('approved','active')
          AND u.first_presence_at IS NULL
          AND b.reserved_start_time <= $1
          AND b.reserved_end_time > $1
          AND EXISTS (
            SELECT 1 FROM room_events re
             WHERE re.room_id = b.room_id
               AND re.event_type = 'occupancy_detected'
               AND re.occupancy_count > 0
               AND re.event_time >= b.reserved_start_time
               AND re.event_time <= $1
          )`,
      [now],
    );

    let confirmed = 0;
    for (const c of candidates) {
      try {
        const reservedEnd = new Date(c.reserved_end_time);
        const upperBound = now < reservedEnd ? now : reservedEnd;
        const streakStart = await this.computeStreakStart(
          this.dataSource.manager,
          c.room_id,
          new Date(c.reserved_start_time),
          upperBound,
          presenceNoiseToleranceSeconds,
        );
        if (!streakStart) continue;
        const durationMs = now.getTime() - streakStart.getTime();
        if (durationMs < presenceConfirmSeconds * 1000) continue;

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        let statusChanged = false;
        try {
          const upd = (await queryRunner.query(
            `UPDATE room_booking_usages
                SET first_presence_at = $2,
                    last_presence_at = $2,
                    occupancy_source = 'camera',
                    usage_status = CASE
                      WHEN usage_status = 'not_started' THEN 'in_use'
                      ELSE usage_status END
              WHERE booking_id = $1 AND first_presence_at IS NULL
              RETURNING id`,
            [c.booking_id, streakStart],
          )) as unknown;
          const updRows = this.rowsOf<{ id: string }>(upd);
          if (updRows.length > 0) {
            const roomUpd = (await queryRunner.query(
              `UPDATE rooms SET current_status = 'occupied'
               WHERE id = $1 AND current_status IS DISTINCT FROM 'occupied'
               RETURNING id`,
              [c.room_id],
            )) as unknown;
            statusChanged = this.rowsOf<{ id: string }>(roomUpd).length > 0;
            confirmed++;
          }
          await queryRunner.commitTransaction();
        } catch (e) {
          await queryRunner.rollbackTransaction();
          throw e;
        } finally {
          await queryRunner.release();
        }

        if (statusChanged) {
          try {
            this.websocketService.emitToRoom(
              `room:${c.room_id}`,
              'room.status.updated',
              {
                roomId: c.room_id,
                status: 'occupied',
                timestamp: now.toISOString(),
              },
            );
          } catch (e) {
            this.logger.warn(
              `WS emit room.status.updated (reconcile) failed: ${
                e instanceof Error ? e.message : 'unknown'
              }`,
            );
          }
        }
      } catch (e) {
        this.logger.error(
          `reconcilePendingConfirmations: booking ${c.booking_id} failed: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    }

    return { scanned: candidates.length, confirmed };
  }

  /** UPDATE…RETURNING qua TypeORM trả [rows,count]; SELECT/INSERT trả rows. Chuẩn hoá. */
  private rowsOf<T>(result: unknown): T[] {
    if (Array.isArray(result)) {
      const head: unknown = result[0];
      if (Array.isArray(head)) return head as T[];
      return result as T[];
    }
    return [];
  }
}
