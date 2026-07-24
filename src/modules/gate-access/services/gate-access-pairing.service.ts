import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, IsNull, Repository } from 'typeorm';
import { GateAccessLogEntity } from '../../zones/entities/gate-access-log.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';

const CLOSING_HOUR_CONFIG_GROUP = 'gate_access';
const CLOSING_HOUR_CONFIG_KEY = 'gate_access.closing_hour_local';
const DEFAULT_CLOSING_HOUR = '22:00';
const CLOSING_HOUR_FORMAT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PAIRING_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h (SRS UC-116 EX2)

export interface PairPendingLogsResult {
  scanned: number;
  paired: number;
  unmatched: number;
}

/**
 * GateAccessPairingService (GAP-001 / UC-116) — ghép cặp bản ghi ra/vào cổng.
 *
 * DATA-01 (crux): KHÔNG INSERT `gate_access_logs` mới — bảng append-only, chỉ UPDATE
 * `paired_log_id`/`duration_seconds` trên 2 dòng đã tồn tại.
 * DATA-02: 2 UPDATE của 1 cặp LUÔN trong 1 transaction.
 * Ghép ưu tiên `user_id` (khớp index `IDX_gate_logs_unpaired`); `user_id` NULL (xe lạ/chưa
 * map người) → fallback `plate_number`. Quyết định đã chốt trực tiếp với Thiếu Chủ (spec §1).
 * KHÔNG tạo synthetic "out" log khi hết giờ đóng cửa — "Chưa hoàn tất" là trạng thái derived
 * tại tầng đọc (UC-117), KHÔNG lưu cột riêng (spec §2.1).
 */
@Injectable()
export class GateAccessPairingService {
  private readonly logger = new Logger(GateAccessPairingService.name);

  constructor(
    @InjectRepository(GateAccessLogEntity)
    private readonly repo: Repository<GateAccessLogEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async pairPendingLogs(): Promise<PairPendingLogsResult> {
    const closingHour = await this.loadClosingHour();

    const outLogs = await this.repo.find({
      where: { direction: 'out', pairedLogId: IsNull() },
      order: { accessTime: 'ASC' },
    });

    let paired = 0;
    let unmatched = 0;

    for (const outLog of outLogs) {
      const candidate = await this.findInCandidate(outLog);
      if (candidate) {
        await this.pairTwo(candidate, outLog);
        paired++;
      } else {
        unmatched++;
      }
    }

    this.logger.debug(
      `pairPendingLogs: scanned=${outLogs.length} paired=${paired} unmatched=${unmatched} closingHour=${closingHour}`,
    );

    return { scanned: outLogs.length, paired, unmatched };
  }

  /**
   * Tìm ứng viên "in" chưa ghép cho 1 log "out". Ưu tiên `userId`; `userId` NULL → fallback
   * `plateNumber` (guard: cả 2 đều NULL → không có tiêu chí ghép, return null NGAY, KHÔNG query).
   * Cửa sổ 24h trước `access_time` của log "out" (SRS UC-116 EX2). BR1 FIFO: ứng viên GẦN NHẤT.
   */
  private async findInCandidate(
    outLog: GateAccessLogEntity,
  ): Promise<GateAccessLogEntity | null> {
    const windowStart = new Date(
      outLog.accessTime.getTime() - PAIRING_WINDOW_MS,
    );

    if (outLog.userId) {
      return this.repo.findOne({
        where: {
          userId: outLog.userId,
          direction: 'in',
          pairedLogId: IsNull(),
          accessTime: Between(windowStart, outLog.accessTime),
        },
        order: { accessTime: 'DESC' },
      });
    }

    if (!outLog.plateNumber) {
      return null;
    }

    return this.repo.findOne({
      where: {
        plateNumber: outLog.plateNumber,
        direction: 'in',
        pairedLogId: IsNull(),
        accessTime: Between(windowStart, outLog.accessTime),
      },
      order: { accessTime: 'DESC' },
    });
  }

  /** Ghép đối xứng: UPDATE cả 2 dòng trong 1 transaction (DATA-02). */
  private async pairTwo(
    inLog: GateAccessLogEntity,
    outLog: GateAccessLogEntity,
  ): Promise<void> {
    const durationSeconds = Math.round(
      (outLog.accessTime.getTime() - inLog.accessTime.getTime()) / 1000,
    );

    await this.dataSource.transaction(async (manager) => {
      await manager.update(GateAccessLogEntity, inLog.id, {
        pairedLogId: outLog.id,
        durationSeconds,
      });
      await manager.update(GateAccessLogEntity, outLog.id, {
        pairedLogId: inLog.id,
        durationSeconds,
      });
    });
  }

  /**
   * Đọc giờ đóng cửa từ `system_configs` (config_group='gate_access'). Thiếu dòng/sai format
   * → fallback default + log warning. KHÔNG hard-code trong service (spec DATA-03).
   */
  private async loadClosingHour(): Promise<string> {
    const configs = await this.dataSource
      .getRepository(SystemConfigEntity)
      .find({
        where: { configGroup: CLOSING_HOUR_CONFIG_GROUP, isActive: true },
      });

    const found = configs.find((c) => c.configKey === CLOSING_HOUR_CONFIG_KEY);
    const value = found?.configValue;

    if (!value || !CLOSING_HOUR_FORMAT_RE.test(value)) {
      if (value) {
        this.logger.warn(
          `gate_access.closing_hour_local sai format ("${value}") — dùng default ${DEFAULT_CLOSING_HOUR}`,
        );
      }
      return DEFAULT_CLOSING_HOUR;
    }

    return value;
  }
}
