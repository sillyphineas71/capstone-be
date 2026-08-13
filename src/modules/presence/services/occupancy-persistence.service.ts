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
 * Mô hình: hiện diện được chia thành các ĐOẠN, ranh giới là lần "rời đi thật" — "rời đi
 * thật" = 1 event `occupancy_count=0` mà KHÔNG có event dương nào theo sau trong vòng
 * `presenceNoiseToleranceSeconds` giây (loại trừ nhiễu cảm biến thoáng qua, vd đứng sát mép
 * khung hình). `presenceConfirmSeconds` vẫn giữ nguyên ý nghĩa chống lách (Case A — vào rồi
 * ra ngay): đoạn ngắn hơn ngưỡng thì không tính. Xem `computeConfirmedSegment()`.
 *
 * [FIX 2026-08-13, R12b] Bản R12 đầu chỉ xét ĐOẠN ĐANG HOẠT ĐỘNG tính tới thời điểm đánh
 * giá — sai với ca "đứng đủ ngưỡng RỒI MỚI rời đi": lúc đánh giá SAU khi đã rời, "đoạn đang
 * hoạt động" luôn rỗng, quên mất đoạn TRƯỚC ĐÓ đã từng đủ giờ. Sửa: xét TOÀN BỘ đoạn (kể cả
 * đã đóng do đã rời đi), lấy đoạn ĐẦU TIÊN đủ ngưỡng — không chỉ đoạn cuối cùng/đang mở.
 * Vì vậy `persist()` nay kiểm tra lại cho CẢ event dương lẫn event=0 (trước đây event=0 bị
 * bỏ qua hoàn toàn), và chỉ cho phép flip `rooms.current_status='occupied'` khi đoạn vừa
 * xác nhận CÒN ĐANG MỞ (`isActive`) — xác nhận qua 1 đoạn đã đóng thì không được báo đang
 * có mặt ngay lúc này.
 *
 * [FIX 2026-08-13, R12 phần 2] Việc tính lại đoạn hiện diện TRƯỚC ĐÂY chỉ chạy khi có event
 * MỚI tới (bên trong `persist()`) — với cảm biến chỉ báo 1-2 lần (vào/ra), có thể không có
 * event nào tới ĐÚNG lúc đủ ngưỡng để kích hoạt tính lại. `reconcilePendingConfirmations()`
 * bù cho khoảng trống này: được cron gọi định kỳ (KHÔNG phụ thuộc có event mới hay không),
 * tính lại tới thời điểm `now()` cho mọi booking chưa xác nhận có mặt.
 *
 * [FIX 2026-08-13, R13] Root cause thật (91.5% booking thật, 118/129 xác nhận trên
 * production) — KHÔNG phải lỗi thuật toán streak: KHÔNG CÓ code nào trong vòng đời booking
 * (tạo/duyệt/đổi phòng) từng tạo dòng `room_booking_usages`; mọi UPDATE trước đây (kể cả
 * persist()/reconcilePendingConfirmations() bản R12/R12b) giả định dòng ĐÃ TỒN TẠI, âm thầm
 * khớp 0 dòng nếu không. Sửa: `upsertPresenceConfirmation()` — `INSERT ... ON CONFLICT
 * (booking_id) DO UPDATE`, tự tạo dòng nếu chưa có. `reconcilePendingConfirmations()` còn có
 * lỗi RIÊNG: INNER JOIN room_booking_usages ở bước chọn ứng viên loại bỏ hẳn các booking
 * thiếu dòng ngay từ đầu — đã đổi LEFT JOIN. Xem chi tiết ở comment của từng hàm.
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
        } else {
          // [FIX 2026-08-13, R12b] Chưa từng xác nhận có mặt — kiểm tra lại đoạn hiện diện
          // gần nhất, BẤT KỂ event hiện tại là dương hay =0. Lý do gộp làm 1 nhánh (trước đây
          // tách riêng, nhánh count==0 luôn no-op): 1 đoạn hiện diện có thể đã đủ
          // presenceConfirmSeconds giây RỒI MỚI kết thúc (event=0 tới) — nếu chỉ kiểm tra lúc
          // event dương, ca "đứng đủ 30s+ rồi rời đi" sẽ KHÔNG BAO GIỜ được xác nhận vì
          // event=0 (event cuối cùng, kích hoạt persist() lần này) trước đây bị bỏ qua hoàn
          // toàn. Xác nhận qua thực tế: đứng 30+ giây rồi rời khung vẫn bị báo no-show.
          const upperBound =
            eventTime < new Date(booking.reserved_end_time)
              ? eventTime
              : new Date(booking.reserved_end_time);
          const confirmedSegment = await this.computeConfirmedSegment(
            queryRunner,
            roomId,
            new Date(booking.reserved_start_time),
            upperBound,
            presenceNoiseToleranceSeconds,
            presenceConfirmSeconds,
          );

          if (confirmedSegment) {
            // [FIX 2026-08-13, R13] UPDATE đơn thuần giả định dòng room_booking_usages ĐÃ
            // TỒN TẠI — không đúng cho MỌI booking thật (xem upsertPresenceConfirmation()).
            // Dữ liệu booking/meeting/room/window đã có sẵn từ SELECT room_bookings phía
            // trên (dòng ~141-148) — KHÔNG query thêm.
            await this.upsertPresenceConfirmation(queryRunner, {
              bookingId: booking.booking_id,
              meetingId: booking.meeting_id,
              roomId,
              reservedStartTime: new Date(booking.reserved_start_time),
              reservedEndTime: new Date(booking.reserved_end_time),
              firstPresenceAt: confirmedSegment.start,
              lastPresenceAt: eventTime,
            });
            // Chỉ cho phép flip rooms.current_status='occupied' nếu đoạn vừa xác nhận
            // CÒN ĐANG MỞ (chưa rời đi) — xác nhận qua chính event=0 (đã rời) thì KHÔNG
            // được đánh dấu occupied (mâu thuẫn: vừa xác nhận có mặt đủ giờ, vừa nói đang
            // có mặt NGAY LÚC NÀY trong khi họ vừa rời khỏi phòng).
            allowRoomStatusFlip = confirmedSegment.isActive;
          } else {
            // Chưa có đoạn nào đủ ngưỡng: KHÔNG update gì cả — event/cron reconcile tiếp
            // theo tự tính lại.
            allowRoomStatusFlip = false;
          }
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
   * [FIX 2026-08-13, R12b] Tìm đoạn hiện diện LIÊN TỤC ĐẦU TIÊN (trong cửa sổ
   * [boundStart, boundEnd]) đã đạt đủ `presenceConfirmSeconds` giây — đoạn có thể ĐÃ ĐÓNG
   * (người rời đi rồi mới được xác nhận, tính theo mốc lúc rời) hoặc CÒN ĐANG MỞ (chưa rời,
   * tính theo `boundEnd`). Trả `null` nếu chưa đoạn nào đủ ngưỡng.
   *
   * Vì sao KHÔNG chỉ xét "đoạn đang hoạt động tính tới boundEnd" (bản R12 lần đầu bị sai):
   * nếu người đứng đủ ngưỡng RỒI MỚI rời đi (event=0 tới), đánh giá tại thời điểm SAU khi
   * rời đi sẽ luôn thấy "đoạn hiện tại" rỗng (không có event dương nào sau lúc rời) —
   * KHÔNG NHỚ được rằng đoạn TRƯỚC ĐÓ đã từng đủ giờ. Phải xét TOÀN BỘ đoạn (kể cả đã đóng),
   * lấy đoạn ĐẦU TIÊN đủ ngưỡng, không chỉ đoạn cuối cùng.
   *
   * "Rời đi thật" = 1 event `occupancy_count=0` KHÔNG có event dương nào theo sau trong
   * vòng `noiseToleranceSeconds` giây (loại nhiễu cảm biến thoáng qua). Mỗi event dương
   * được gán vào 1 đoạn theo lần rời-đi-thật GẦN NHẤT TRƯỚC nó; đoạn kết thúc ở lần rời-đi-
   * thật kế tiếp (nếu có) hoặc `boundEnd` (nếu đoạn còn đang mở).
   *
   * Dùng chung cho cả 2 nơi: persist() (boundEnd = eventTime của event vừa nhận — chạy cho
   * CẢ event dương lẫn event=0, không chỉ event dương) và reconcilePendingConfirmations()
   * (boundEnd = now(), không phụ thuộc có event mới hay không) — 1 nguồn tính toán DUY NHẤT.
   */
  private async computeConfirmedSegment(
    executor: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    roomId: string,
    boundStart: Date,
    boundEnd: Date,
    noiseToleranceSeconds: number,
    presenceConfirmSeconds: number,
  ): Promise<{ start: Date; isActive: boolean } | null> {
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
       positive_events AS (
         SELECT event_time
           FROM room_events
          WHERE room_id = $1
            AND event_type = 'occupancy_detected'
            AND occupancy_count > 0
            AND event_time >= $2
            AND event_time <= $3
       ),
       -- Gán mỗi event dương vào 1 đoạn hiện diện, nhóm theo lần rời-đi-thật GẦN NHẤT
       -- TRƯỚC nó (NULL = trước lần rời đi thật đầu tiên, hoặc chưa từng có lần nào).
       tagged AS (
         SELECT p.event_time,
                (SELECT MAX(d.event_time) FROM real_departures d
                  WHERE d.event_time < p.event_time) AS since
           FROM positive_events p
       ),
       segments AS (
         SELECT since, MIN(event_time) AS seg_start, MAX(event_time) AS seg_last_positive
           FROM tagged
          GROUP BY since
       ),
       -- Đoạn CÒN ĐANG MỞ (chưa có lần rời-đi-thật nào sau event dương cuối của nó) → dùng
       -- boundEnd làm mốc kết thúc tạm; đoạn ĐÃ ĐÓNG → dùng đúng thời điểm rời đi thật.
       segments_end AS (
         SELECT s.seg_start,
                (SELECT MIN(d.event_time) FROM real_departures d
                  WHERE d.event_time > s.seg_last_positive) AS next_departure
           FROM segments s
       )
       SELECT seg_start, (next_departure IS NULL) AS is_active
         FROM segments_end
        WHERE COALESCE(next_departure, $3::timestamptz) - seg_start
              >= ($5::int * interval '1 second')
        ORDER BY seg_start ASC
        LIMIT 1`,
      [
        roomId,
        boundStart,
        boundEnd,
        noiseToleranceSeconds,
        presenceConfirmSeconds,
      ],
    )) as Array<{ seg_start: Date | string; is_active: boolean }>;
    const row = rows?.[0];
    if (!row) return null;
    return { start: new Date(row.seg_start), isActive: row.is_active };
  }

  /**
   * [FIX 2026-08-13, R13] Ghi kết quả xác nhận có mặt — UPSERT, KHÔNG phải UPDATE đơn
   * thuần. Root cause đêm nay (91.5% booking thật, 118/129 xác nhận trên production):
   * KHÔNG CÓ code nào trong toàn bộ vòng đời booking (tạo cuộc họp, duyệt request, đổi
   * phòng/giờ — grep hết `meetings.service.ts`/`meeting-request-review.service.ts`/
   * `room-bookings.service.ts`) từng tạo dòng `room_booking_usages` — dòng này chỉ tồn
   * tại nếu 1 migration seed demo (`20260720000009-SeedDemoAttendancePresenceUsage.ts`,
   * CHỈ áp dụng data demo `MTG-2026-*`) đã tạo sẵn. Mọi UPDATE trước đây (kể cả bản R12/
   * R12b) đều giả định dòng ĐÃ TỒN TẠI — nếu không, UPDATE khớp 0 dòng, KHÔNG lỗi, âm
   * thầm không làm gì — first_presence_at vĩnh viễn NULL dù thuật toán streak tính đúng.
   *
   * `ON CONFLICT (booking_id)` dùng được ngay — xác nhận có UNIQUE constraint thật trên
   * DB (`ux_room_booking_usages_booking`), dù KHÔNG khai báo trong entity TypeORM (bảng
   * này không có migration tạo bảng trong repo — ngoài luồng migration thông thường).
   *
   * `first_presence_at` dùng COALESCE ở nhánh conflict — giữ ĐÚNG mốc lần đầu xác nhận
   * thật, không bị dịch lại mỗi lần có event mới/mỗi lần reconcile chạy. `WHERE
   * room_booking_usages.first_presence_at IS NULL` trên chính nhánh DO UPDATE — nếu dòng
   * đã được xác nhận từ trước (bởi chính lần gọi khác, kể cả race 2 request đồng thời),
   * KHÔNG update gì cả (Postgres tự xử lý — DO UPDATE với WHERE false = như DO NOTHING
   * cho dòng đó), RETURNING trả 0 dòng → `confirmed=false`, không đếm trùng, không lỗi
   * constraint (2 INSERT đồng thời cùng booking_id: 1 thắng INSERT thật, 1 rơi vào nhánh
   * conflict — Postgres tự khoá row, không có race lộ ra ngoài).
   *
   * Dùng chung cho CẢ persist() (trong transaction đang mở của queryRunner) LẪN
   * reconcilePendingConfirmations() (transaction riêng mở cho từng booking) — 1 nguồn
   * ghi DUY NHẤT, tránh 2 câu SQL lệch nhau.
   */
  private async upsertPresenceConfirmation(
    executor: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    params: {
      bookingId: string;
      meetingId: string;
      roomId: string;
      reservedStartTime: Date;
      reservedEndTime: Date;
      firstPresenceAt: Date;
      lastPresenceAt: Date;
    },
  ): Promise<{ confirmed: boolean }> {
    const result = await executor.query(
      `INSERT INTO room_booking_usages
         (booking_id, meeting_id, room_id, reserved_start_time, reserved_end_time,
          first_presence_at, last_presence_at, occupancy_source, usage_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'camera', 'in_use')
       ON CONFLICT (booking_id) DO UPDATE SET
         first_presence_at = COALESCE(
           room_booking_usages.first_presence_at, EXCLUDED.first_presence_at
         ),
         last_presence_at = EXCLUDED.last_presence_at,
         occupancy_source = EXCLUDED.occupancy_source,
         usage_status = CASE
           WHEN room_booking_usages.usage_status = 'not_started' THEN 'in_use'
           ELSE room_booking_usages.usage_status
         END
       WHERE room_booking_usages.first_presence_at IS NULL
       RETURNING id`,
      [
        params.bookingId,
        params.meetingId,
        params.roomId,
        params.reservedStartTime,
        params.reservedEndTime,
        params.firstPresenceAt,
        params.lastPresenceAt,
      ],
    );
    return { confirmed: this.rowsOf<{ id: string }>(result).length > 0 };
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

    // [FIX 2026-08-13, R13] JOIN thường (INNER) loại bỏ HẲN mọi booking CHƯA CÓ dòng
    // room_booking_usages (đúng root cause đêm nay) — đổi LEFT JOIN + điều kiện
    // "u.first_presence_at IS NULL OR u.id IS NULL" để KHÔNG bỏ sót các booking chưa từng
    // được tạo dòng usages. Thêm b.meeting_id vào SELECT — cần cho upsertPresenceConfirmation().
    const candidates: Array<{
      booking_id: string;
      meeting_id: string;
      room_id: string;
      reserved_start_time: Date | string;
      reserved_end_time: Date | string;
    }> = await this.dataSource.manager.query(
      `SELECT b.id AS booking_id, b.meeting_id, b.room_id, b.reserved_start_time, b.reserved_end_time
         FROM room_bookings b
         LEFT JOIN room_booking_usages u ON u.booking_id = b.id
        WHERE b.status IN ('approved','active')
          AND (u.first_presence_at IS NULL OR u.id IS NULL)
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
        const confirmedSegment = await this.computeConfirmedSegment(
          this.dataSource.manager,
          c.room_id,
          new Date(c.reserved_start_time),
          upperBound,
          presenceNoiseToleranceSeconds,
          presenceConfirmSeconds,
        );
        if (!confirmedSegment) continue;

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        let statusChanged = false;
        try {
          // [FIX 2026-08-13, R13] UPSERT thay UPDATE đơn thuần — xem
          // upsertPresenceConfirmation(). last_presence_at dùng confirmedSegment.start vì
          // reconcile không có "eventTime" thật (không có event mới nào kích hoạt) — mốc
          // hợp lý nhất hiện có là chính lúc xác nhận (đầu đoạn), KHÔNG suy đoán thêm.
          const { confirmed: justConfirmed } =
            await this.upsertPresenceConfirmation(queryRunner, {
              bookingId: c.booking_id,
              meetingId: c.meeting_id,
              roomId: c.room_id,
              reservedStartTime: new Date(c.reserved_start_time),
              reservedEndTime: new Date(c.reserved_end_time),
              firstPresenceAt: confirmedSegment.start,
              lastPresenceAt: confirmedSegment.start,
            });
          // Chỉ flip rooms.current_status='occupied' nếu đoạn vừa xác nhận CÒN ĐANG MỞ
          // (người vẫn còn trong phòng) — đoạn đã đóng (họ rời đi rồi mới được reconcile
          // xác nhận) thì KHÔNG được đánh dấu occupied.
          if (justConfirmed && confirmedSegment.isActive) {
            const roomUpd = (await queryRunner.query(
              `UPDATE rooms SET current_status = 'occupied'
               WHERE id = $1 AND current_status IS DISTINCT FROM 'occupied'
               RETURNING id`,
              [c.room_id],
            )) as unknown;
            statusChanged = this.rowsOf<{ id: string }>(roomUpd).length > 0;
          }
          if (justConfirmed) confirmed++;
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
