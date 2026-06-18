import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  FaceVerifyHook,
  FaceVerifyInput,
} from '../../../common/ports/face-verify-hook.js';

interface MappingRow {
  user_id: string;
  metadata_json: Record<string, unknown> | null;
}
interface MeetingRow {
  id: string;
  start_time: Date | string;
  end_time: Date | string;
  actual_end_time: Date | string | null;
  status: string;
}

/**
 * FaceAttendanceService (FAT-001 / Ticket C) — verify event → điểm danh.
 *
 * NC-1: CHỈ ghi điểm danh, KHÔNG gác/deny cửa.
 * NC-5: resolve user + meeting từ device_user_mappings (B), không tìm meeting active riêng.
 * NC-3: verify đầu = check-in; verify sau chỉ cập nhật last_detected_at.
 * Anomaly (no-mapping/no-meeting) chỉ log — raw event đã ở iot_device_events (spec §2.3).
 * SEC-03 parameterized, raw qua DataSource, DATA-01 no migration.
 */
@Injectable()
export class FaceAttendanceService implements FaceVerifyHook {
  private readonly logger = new Logger(FaceAttendanceService.name);
  private static readonly DEFAULT_LATE_GRACE_MINUTES = 0;
  // Cho phép quét trễ sau giờ kết thúc bao nhiêu phút vẫn ghi (mặc định 0 = chặn ngay khi quá end).
  private static readonly POST_GRACE_MINUTES = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async onVerify(input: FaceVerifyInput): Promise<void> {
    const { deviceId, roomId, personId, personName, verifyTime } = input;

    // NC-5: resolve (user, meeting) từ mapping.
    const resolved = await this.resolveMapping(deviceId, personId, personName);
    if (!resolved) {
      this.logger.warn(
        `verify unmatched: device=${deviceId} person_id=${personId ?? '∅'} person_name=${personName ?? '∅'} — no record.`,
      );
      return;
    }
    const { userId, meetingId } = resolved;

    // Load meeting. Không thấy → anomaly.
    const meetings: MeetingRow[] = await this.dataSource.manager.query(
      `SELECT id, start_time, end_time, actual_end_time, status
         FROM meetings WHERE id = $1 LIMIT 1`,
      [meetingId],
    );
    const meeting = meetings?.[0];
    if (!meeting) {
      this.logger.warn(
        `verify no-meeting: meetingId=${meetingId} (user=${userId}) không tồn tại — no record.`,
      );
      return;
    }

    // Gate "họp còn mở": đã completed/cancelled HOẶC verify sau giờ kết thúc → KHÔNG ghi.
    const effectiveEnd = new Date(meeting.actual_end_time ?? meeting.end_time);
    const postGraceMs = FaceAttendanceService.POST_GRACE_MINUTES * 60_000;
    const meetingClosed =
      meeting.status === 'completed' ||
      meeting.status === 'cancelled' ||
      verifyTime.getTime() > effectiveEnd.getTime() + postGraceMs;
    if (meetingClosed) {
      this.logger.warn(
        `verify after meeting closed: meeting=${meetingId} status=${meeting.status} verifyTime=${verifyTime.toISOString()} end=${effectiveEnd.toISOString()} — no record.`,
      );
      return;
    }

    // NC-2: late theo grace.
    const grace = await this.getLateGraceMinutes();
    const start = new Date(meeting.start_time);
    const isLate = verifyTime.getTime() > start.getTime() + grace * 60_000;
    const lateMinutes = isLate
      ? Math.max(
          0,
          Math.round((verifyTime.getTime() - start.getTime()) / 60_000),
        )
      : 0;

    // Upsert record (NC-3).
    const existing: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT id FROM attendance_records WHERE meeting_id = $1 AND user_id = $2 LIMIT 1`,
      [meetingId, userId],
    );

    let recordId: string;
    let eventType: string;
    if (existing[0]) {
      recordId = existing[0].id;
      eventType = 'face_detected';
      await this.dataSource.manager.query(
        `UPDATE attendance_records SET last_detected_at = $2, updated_at = now() WHERE id = $1`,
        [recordId, verifyTime],
      );
    } else {
      const status = isLate ? 'late' : 'present';
      const inserted: Array<{ id: string }> =
        await this.dataSource.manager.query(
          `INSERT INTO attendance_records
             (meeting_id, user_id, check_in_method, attendance_source,
              check_in_time, first_detected_at, last_detected_at,
              is_present, is_late, late_minutes, attendance_status)
           VALUES ($1,$2,'door_camera','camera',$3,$3,$3,true,$4,$5,$6)
           RETURNING id`,
          [meetingId, userId, verifyTime, isLate, lateMinutes, status],
        );
      recordId = inserted[0].id;
      eventType = 'check_in';
    }

    // FR-006: ghi event mỗi verify.
    await this.dataSource.manager.query(
      `INSERT INTO attendance_events
         (meeting_id, attendance_record_id, user_id, room_id, device_id,
          event_type, event_time, source_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'camera')`,
      [meetingId, recordId, userId, roomId, deviceId, eventType, verifyTime],
    );

    this.logger.log(
      `attendance ${eventType}: user=${userId} meeting=${meetingId} late=${isLate} (+${lateMinutes}m).`,
    );
  }

  /**
   * NC-5 resolve: device_id + device_person_id=personId (primary);
   * fallback device_person_code=personName. meetingId = metadata_json.bookingId.
   */
  private async resolveMapping(
    deviceId: string,
    personId: string | null,
    personName: string | null,
  ): Promise<{ userId: string; meetingId: string } | null> {
    // Chỉ match mapping ĐANG hiệu lực: sync_status='synced' + chưa soft-delete.
    // Mapping đã 'deleted' (sau deprovision) KHÔNG resolve → không ghi điểm danh
    // dù còn mặt sót trên cam.
    let rows: MappingRow[] = [];
    if (personId) {
      rows = await this.dataSource.manager.query(
        `SELECT user_id, metadata_json FROM device_user_mappings
         WHERE device_id = $1 AND device_person_id = $2
           AND sync_status = 'synced' AND deleted_at IS NULL
         ORDER BY last_synced_at DESC NULLS LAST LIMIT 1`,
        [deviceId, personId],
      );
    }
    if (!rows[0] && personName) {
      rows = await this.dataSource.manager.query(
        `SELECT user_id, metadata_json FROM device_user_mappings
         WHERE device_id = $1 AND device_person_code = $2
           AND sync_status = 'synced' AND deleted_at IS NULL
         ORDER BY last_synced_at DESC NULLS LAST LIMIT 1`,
        [deviceId, personName],
      );
    }
    const row = rows[0];
    if (!row) return null;

    const bookingId = row.metadata_json?.['bookingId'];
    if (typeof bookingId !== 'string' || !bookingId) return null;
    return { userId: row.user_id, meetingId: bookingId };
  }

  /** NC-2: system_configs[attendance.late_grace_minutes] → env → default 0. */
  private async getLateGraceMinutes(): Promise<number> {
    try {
      const rows: Array<{ config_value: string | null }> =
        await this.dataSource.manager.query(
          `SELECT config_value FROM system_configs WHERE config_key = 'attendance.late_grace_minutes' LIMIT 1`,
        );
      const raw = rows?.[0]?.config_value;
      if (raw != null && raw !== '') {
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n) && n >= 0) return n;
      }
    } catch (e) {
      this.logger.warn(
        `read attendance.late_grace_minutes failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
    return this.configService.get<number>(
      'ATTENDANCE_LATE_GRACE_MINUTES',
      FaceAttendanceService.DEFAULT_LATE_GRACE_MINUTES,
    );
  }
}
