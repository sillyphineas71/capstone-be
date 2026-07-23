import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';

/** Kết quả 1 lần ghép. */
export type PairOutcome = 'paired' | 'skipped';
/** Summary 1 lô cron. */
export interface PairBatchResult {
  scanned: number;
  paired: number;
  skipped: number;
}

/** Lô tối đa mỗi lần chạy (OQ-6). Hằng code (không phải input người dùng). */
const BATCH = 300;
const MS_PER_HOUR = 3_600_000;

/**
 * GateLogPairingService (GAP-001 / UC-106) — ghép cặp enter/leave trong `gate_access_logs`,
 * ghi `paired_log_id` (hai chiều) + `duration_seconds` (cả hai bản).
 *
 * Kích hoạt: cron `gate-log-pairing` (SchedulerService) gọi `pairBatch()`; UC-105 (writer)
 * sau này gọi `pairForLeaveLog()` để ghép-ngay khi ingest.
 *
 * ⚠⚠ BẢNG APPEND-ONLY: `gate_access_logs` KHÔNG có `deleted_at` ⇒ TUYỆT ĐỐI KHÔNG
 * `deletedAt`/`IsNull()`. KHÔNG đụng `GateAccessLogService` (UC-107 read-only, QĐ-7).
 *
 * Chống ghép trùng 2 lớp: (1) `FOR UPDATE SKIP LOCKED` khi khoá bản `leave` VÀ `enter` — bỏ
 * qua bản đang bị tiến trình khác giữ, KHÔNG chờ (SchedulerService không chống chồng lấn, và
 * UC-105 gọi song song); (2) partial unique index `UQ_gate_logs_paired` — race thua → 23505 →
 * rollback-bỏ-qua, KHÔNG ném (là race đã chặn đúng, không phải lỗi).
 */
@Injectable()
export class GateLogPairingService {
  private readonly logger = new Logger(GateLogPairingService.name);
  private readonly windowH: number;
  private readonly bufferH: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.windowH = this.configService.get<number>(
      'GATE_PAIRING_WINDOW_HOURS',
      24,
    );
    this.bufferH = this.configService.get<number>(
      'GATE_PAIRING_BUFFER_HOURS',
      1,
    );
  }

  /**
   * Cron gọi: quét lô bản `leave` chưa ghép trong cửa sổ (chống quét vô hạn — OQ-3), CŨ NHẤT
   * TRƯỚC (accessTime ASC — OQ-1), ghép từng bản trong transaction riêng.
   */
  async pairBatch(): Promise<PairBatchResult> {
    const scanFrom = new Date(
      Date.now() - (this.windowH + this.bufferH) * MS_PER_HOUR,
    );

    // Chỉ đối tượng định danh (user_id NOT NULL — OQ-7: xe chưa đăng ký không ghép ở v1).
    // KHÔNG deletedAt (bảng append-only). LIMIT hằng code.
    const rows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT id FROM gate_access_logs
        WHERE direction = $1
          AND paired_log_id IS NULL
          AND user_id IS NOT NULL
          AND access_time >= $2
        ORDER BY access_time ASC
        LIMIT ${BATCH}`,
      ['leave', scanFrom],
    );

    let scanned = 0;
    let paired = 0;
    let skipped = 0;
    for (const row of rows) {
      scanned++;
      const outcome = await this.pairOneInOwnTx(row.id);
      if (outcome === 'paired') paired++;
      else skipped++;
    }
    return { scanned, paired, skipped };
  }

  /**
   * UC-105 (writer) gọi ghép-ngay 1 bản `leave` khi ingest. `manager` = transaction của caller
   * (ARCH-01) — có thì chạy trong đó (caller tự commit); không thì tự quản transaction.
   */
  async pairForLeaveLog(
    leaveId: string,
    manager?: EntityManager,
  ): Promise<PairOutcome> {
    if (manager) {
      return this.pairOneWithManager(manager, leaveId);
    }
    return this.pairOneInOwnTx(leaveId);
  }

  /** Bọc transaction + bắt 23505 (race — rollback bỏ qua, KHÔNG ném). `finally release()`. */
  private async pairOneInOwnTx(leaveId: string): Promise<PairOutcome> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const outcome = await this.pairOneWithManager(qr.manager, leaveId);
      await qr.commitTransaction();
      return outcome;
    } catch (e) {
      await qr.rollbackTransaction();
      if (this.isUniqueViolation(e)) {
        // Race đã được UQ_gate_logs_paired chặn đúng — KHÔNG phải lỗi.
        this.logger.log(
          `gate-log-pairing: race skip leave=${leaveId} (23505, đã ghép bởi tiến trình khác)`,
        );
        return 'skipped';
      }
      throw e;
    } finally {
      await qr.release();
    }
  }

  /**
   * Lõi ghép — GIẢ ĐỊNH đang trong transaction (caller mở). KHÔNG commit/release ở đây.
   * Khoá bằng FOR UPDATE SKIP LOCKED (bỏ qua bản đang bị khoá, không chờ).
   */
  private async pairOneWithManager(
    manager: EntityManager,
    leaveId: string,
  ): Promise<PairOutcome> {
    // 1. Khoá bản leave (id + chưa ghép). SKIP LOCKED: đang bị khoá nơi khác → [] → skipped.
    const lRows: Array<{ id: string; user_id: string; access_time: Date }> =
      await manager.query(
        `SELECT id, user_id, access_time FROM gate_access_logs
        WHERE id = $1 AND direction = $2 AND paired_log_id IS NULL
        FOR UPDATE SKIP LOCKED`,
        [leaveId, 'leave'],
      );
    if (lRows.length === 0) return 'skipped';
    const L = lRows[0];

    // 2. Tìm + khoá bản enter ứng viên: cùng user, trước leave, trong cửa sổ, LIFO (gần nhất).
    //    KHÔNG bắt cùng zone_id (OQ-1). KHÔNG deletedAt. SKIP LOCKED: ứng viên gần nhất bị khoá
    //    → PostgreSQL trả bản kế theo cùng LIFO, không chờ.
    const enterFrom = new Date(
      new Date(L.access_time).getTime() - this.windowH * MS_PER_HOUR,
    );
    const eRows: Array<{ id: string; access_time: Date }> = await manager.query(
      `SELECT id, access_time FROM gate_access_logs
        WHERE direction = $1 AND paired_log_id IS NULL
          AND user_id = $2
          AND access_time < $3
          AND access_time >= $4
        ORDER BY access_time DESC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      ['enter', L.user_id, L.access_time, enterFrom],
    );
    if (eRows.length === 0) return 'skipped'; // leave mồ côi (quên quét vào) — để NULL (OQ-3).
    const E = eRows[0];

    // 3. duration = leave - enter (giây, floor). Ghi CẢ HAI bản (OQ-4), hai chiều (OQ-5).
    const durationSeconds = Math.floor(
      (new Date(L.access_time).getTime() - new Date(E.access_time).getTime()) /
        1000,
    );

    await manager.query(
      `UPDATE gate_access_logs SET paired_log_id = $1, duration_seconds = $2 WHERE id = $3`,
      [E.id, durationSeconds, L.id],
    );
    await manager.query(
      `UPDATE gate_access_logs SET paired_log_id = $1, duration_seconds = $2 WHERE id = $3`,
      [L.id, durationSeconds, E.id],
    );
    return 'paired';
  }

  /** Postgres unique_violation = 23505 (TypeORM QueryFailedError.driverError.code). Viết mới
   * trong service này — KHÔNG import từ `anpr`, không dùng chéo private của ZonesService. */
  private isUniqueViolation(e: unknown): boolean {
    const code =
      (e as { driverError?: { code?: string }; code?: string })?.driverError
        ?.code ?? (e as { code?: string })?.code;
    return code === '23505';
  }
}
