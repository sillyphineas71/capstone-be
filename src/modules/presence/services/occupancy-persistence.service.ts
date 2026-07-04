import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WebsocketService } from '../../websocket/websocket.service.js';

export interface PersistOccupancyInput {
  roomId: string;
  meetingId: string | null;
  occupancyCount: number;
  confidence: number | null;
  eventTime: Date;
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
 */
@Injectable()
export class OccupancyPersistenceService {
  private readonly logger = new Logger(OccupancyPersistenceService.name);
  private static readonly MAX_OCCUPANCY = 1000; // chặn số vô lý.

  constructor(
    private readonly dataSource: DataSource,
    private readonly websocketService: WebsocketService,
  ) {}

  /**
   * Persist occupancy: room_events + (nếu booking) presence_snapshots + room_booking_usages
   * + rooms.current_status (count>0→occupied) trong transaction; sau đó WS best-effort.
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
      const bookingRows = (await queryRunner.query(
        `SELECT id AS booking_id, meeting_id FROM room_bookings
           WHERE room_id = $1 AND reserved_start_time <= $2 AND reserved_end_time >= $2
             AND status IN ('approved','active')
           ORDER BY reserved_start_time ASC LIMIT 1`,
        [roomId, eventTime],
      )) as Array<{ booking_id: string; meeting_id: string }>;
      const booking = bookingRows?.[0];

      if (booking) {
        // presence_snapshots (meeting_id NOT NULL → cần booking.meeting_id)
        await queryRunner.query(
          `INSERT INTO presence_snapshots
             (meeting_id, room_id, occupancy_count, presence_status, snapshot_time, source_type, confidence_score)
           VALUES ($1,$2,$3,'present',$4,'camera',$5)`,
          [booking.meeting_id, roomId, occupancyCount, eventTime, confidence],
        );

        // room_booking_usages (nếu có)
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
      }

      // c. status: count>0 → occupied (count==0 KHÔNG đổi — D-4).
      //    RETURNING id để biết status THẬT SỰ đổi → emit room.status.updated chỉ khi đổi.
      if (occupancyCount > 0) {
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
