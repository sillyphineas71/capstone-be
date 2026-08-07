import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { GateAccessLogEntity } from '../../zones/entities/gate-access-log.entity.js';
import { ZonePresenceEventEntity } from '../../zones/entities/zone-presence-event.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import { AlertRuleEntity } from '../../alerts/entities/alert-rule.entity.js';
import { AlertRulesService } from '../../alerts/services/alert-rules.service.js';
import { AlertsService } from '../../alerts/services/alerts.service.js';

const CONFIG_GROUP = 'restricted_zone_intrusion';
const GATE_LOG_WATERMARK_KEY = 'restricted_zone.gate_log_watermark';
const PRESENCE_EVENT_WATERMARK_KEY = 'restricted_zone.presence_event_watermark';
import { ZONE_PRESENCE_EVENT_TYPES } from '../../zones/constants/zone-presence-event-type.constant.js';

export interface EvaluateIntrusionsResult {
  zonesScanned: number;
  gateLogsChecked: number;
  presenceEventsChecked: number;
  violationsFound: number;
}

interface RestrictedHours {
  allowFrom?: string;
  allowTo?: string;
}

/**
 * RestrictedZoneIntrusionService (ARZ-001 / UC-124) — cron đối chiếu `gate_access_logs`
 * + `zone_presence_events` với `alert_rules` (`alert_type='intrusion'`, GẮN ZONE CỤ THỂ)
 * để phát hiện xâm nhập khu vực hạn chế.
 *
 * DATA-01: KHÔNG ghi `gate_access_logs`/`zone_presence_events` (append-only, chỉ đọc).
 * PERF-01: watermark cursor qua `system_configs` — KHÔNG full-scan 2 bảng log mỗi lần chạy,
 * KHÔNG quét lùi dữ liệu lịch sử ở lần chạy đầu (R5). Dedup vi phạm liên tiếp cùng zone qua
 * `recordAlert()` có sẵn (UC-123), KHÔNG tự chế logic chống trùng riêng.
 */
@Injectable()
export class RestrictedZoneIntrusionService {
  private readonly logger = new Logger(RestrictedZoneIntrusionService.name);

  constructor(
    @InjectRepository(GateAccessLogEntity)
    private readonly gateLogRepo: Repository<GateAccessLogEntity>,
    @InjectRepository(ZonePresenceEventEntity)
    private readonly presenceRepo: Repository<ZonePresenceEventEntity>,
    private readonly alertRulesService: AlertRulesService,
    private readonly alertsService: AlertsService,
    private readonly dataSource: DataSource,
  ) {}

  async evaluateIntrusions(): Promise<EvaluateIntrusionsResult> {
    const rules = await this.loadZoneScopedIntrusionRules();
    const gateWatermark = await this.loadWatermark(GATE_LOG_WATERMARK_KEY);
    const presenceWatermark = await this.loadWatermark(
      PRESENCE_EVENT_WATERMARK_KEY,
    );

    let gateLogsChecked = 0;
    let presenceEventsChecked = 0;
    let violationsFound = 0;
    let maxGateTime = gateWatermark;
    let maxPresenceTime = presenceWatermark;

    for (const rule of rules) {
      const zoneId = rule.zoneId as string; // đã filter zoneId !== null ở loadZoneScopedIntrusionRules

      const logs = await this.gateLogRepo.find({
        where: {
          zoneId,
          direction: 'enter',
          accessTime: MoreThan(gateWatermark),
        },
      });
      for (const log of logs) {
        gateLogsChecked++;
        if (this.isViolation(rule, log.userId, log.accessTime)) {
          violationsFound++;
          await this.recordIntrusion(rule, {
            sourceTable: 'gate_access_logs',
            sourceRowId: log.id,
            userId: log.userId,
            occurredAt: log.accessTime.toISOString(),
          });
        }
        if (log.accessTime > maxGateTime) maxGateTime = log.accessTime;
      }

      const events = await this.presenceRepo.find({
        where: {
          zoneId,
          eventType: ZONE_PRESENCE_EVENT_TYPES[0],
          eventTime: MoreThan(presenceWatermark),
        },
      });
      for (const evt of events) {
        presenceEventsChecked++;
        if (this.isViolation(rule, evt.userId, evt.eventTime)) {
          violationsFound++;
          await this.recordIntrusion(rule, {
            sourceTable: 'zone_presence_events',
            sourceRowId: evt.id,
            userId: evt.userId,
            occurredAt: evt.eventTime.toISOString(),
          });
        }
        if (evt.eventTime > maxPresenceTime) maxPresenceTime = evt.eventTime;
      }
    }

    await this.saveWatermark(GATE_LOG_WATERMARK_KEY, maxGateTime);
    await this.saveWatermark(PRESENCE_EVENT_WATERMARK_KEY, maxPresenceTime);

    this.logger.debug(
      `evaluateIntrusions: zones=${rules.length} gateLogs=${gateLogsChecked} presenceEvents=${presenceEventsChecked} violations=${violationsFound}`,
    );

    return {
      zonesScanned: rules.length,
      gateLogsChecked,
      presenceEventsChecked,
      violationsFound,
    };
  }

  /**
   * Đường TỨC THỜI (bên cạnh cron `evaluateIntrusions()` — KHÔNG thay thế, cron vẫn
   * chạy làm lưới quét bù cho các trường hợp bỏ lỡ, vd event đến lúc rule vừa bật).
   * Gọi ngay sau khi 1 zone-presence "appear" event được ghi, để cảnh báo xuất hiện
   * ngay thay vì đợi tới chu kỳ cron. isViolation() thuần tuý, không phụ thuộc
   * watermark → gọi trực tiếp an toàn.
   *
   * Chỉ tải rule của ĐÚNG zoneId (query DB có `zoneId` filter sẵn trong
   * `AlertRulesService.list()`) — KHÔNG dùng `loadZoneScopedIntrusionRules()` (tải
   * TẤT CẢ zone rồi lọc JS, tốn cho đường per-event). Số rule intrusion active/zone
   * thường 0-1 → 1 query nhẹ, không cần cache.
   *
   * Dedupe: KHÔNG thêm cờ "đã xử lý tức thời" nào — dựa hoàn toàn vào
   * `AlertsService.recordAlert()` (unique index mở theo alertType+zoneId, §UC-123).
   * Nếu cron quét lại đúng event này sau đó, `recordAlert()` chỉ bump
   * `occurrenceCount` trên alert đã mở, KHÔNG tạo alert thứ 2 (không double-alert).
   */
  async evaluateZoneEventNow(args: {
    zoneId: string;
    userId: string | null;
    eventTime: Date;
    sourceTable: string;
    sourceRowId: string;
  }): Promise<boolean> {
    const { items: rules } = await this.alertRulesService.list({
      alertType: 'intrusion',
      zoneId: args.zoneId,
      enabled: true,
      page: 1,
      limit: 50,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    let violated = false;
    for (const rule of rules) {
      if (this.isViolation(rule, args.userId, args.eventTime)) {
        violated = true;
        await this.recordIntrusion(rule, {
          sourceTable: args.sourceTable,
          sourceRowId: args.sourceRowId,
          userId: args.userId,
          occurredAt: args.eventTime.toISOString(),
        });
      }
    }
    return violated;
  }

  private async recordIntrusion(
    rule: AlertRuleEntity,
    payloadJson: Record<string, unknown>,
  ): Promise<void> {
    await this.alertsService.recordAlert({
      alertType: 'intrusion',
      zoneId: rule.zoneId,
      ruleId: rule.id,
      payloadJson,
    });
  }

  /**
   * isViolation (spec §2.3) — trong khung giờ cho phép → KHÔNG vi phạm bất kể userId;
   * ngoài khung (hoặc rule không có khung giờ hợp lệ) → chỉ userId trong
   * `allowedPersonIdsJson` mới KHÔNG vi phạm; userId NULL (chưa định danh) → LUÔN vi phạm.
   */
  private isViolation(
    rule: AlertRuleEntity,
    userId: string | null,
    occurredAt: Date,
  ): boolean {
    const hours = rule.restrictedHoursJson as RestrictedHours | null;
    if (
      hours?.allowFrom &&
      hours?.allowTo &&
      this.isWithinAllowedHours(
        { allowFrom: hours.allowFrom, allowTo: hours.allowTo },
        occurredAt,
      )
    ) {
      return false;
    }

    if (!userId) return true;
    const allowed = rule.allowedPersonIdsJson ?? [];
    return !allowed.includes(userId);
  }

  /** Xử lý qua đêm: allowFrom > allowTo (vd 22:00→06:00) → trong khung nếu >=from HOẶC <=to. */
  private isWithinAllowedHours(
    hours: { allowFrom: string; allowTo: string },
    occurredAt: Date,
  ): boolean {
    const toMinutes = (hhmm: string): number => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const from = toMinutes(hours.allowFrom);
    const to = toMinutes(hours.allowTo);
    const current = occurredAt.getHours() * 60 + occurredAt.getMinutes();

    if (from <= to) {
      return current >= from && current <= to;
    }
    return current >= from || current <= to; // qua đêm
  }

  /** Chỉ rule intrusion GẮN ZONE CỤ THỂ (§2.1) — rule "toàn khuôn viên" bị bỏ qua có chủ đích. */
  private async loadZoneScopedIntrusionRules(): Promise<AlertRuleEntity[]> {
    const { items } = await this.alertRulesService.list({
      alertType: 'intrusion',
      enabled: true,
      page: 1,
      limit: 500,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    return items.filter((r) => r.zoneId !== null);
  }

  /**
   * loadWatermark (§2.4/R5) — KHÔNG có dòng → khởi tạo = thời điểm HIỆN TẠI (KHÔNG quét
   * lùi dữ liệu lịch sử) và lưu luôn (tránh reset watermark mỗi lần restart process).
   */
  private async loadWatermark(key: string): Promise<Date> {
    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const existing = await repo.findOne({
      where: { configGroup: CONFIG_GROUP, configKey: key },
    });
    if (existing?.configValue) {
      const parsed = new Date(existing.configValue);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    const now = new Date();
    await this.saveWatermark(key, now);
    return now;
  }

  private async saveWatermark(key: string, value: Date): Promise<void> {
    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const existing = await repo.findOne({
      where: { configGroup: CONFIG_GROUP, configKey: key },
    });
    if (existing) {
      existing.configValue = value.toISOString();
      await repo.save(existing);
      return;
    }
    const entity = repo.create({
      configGroup: CONFIG_GROUP,
      configKey: key,
      configValue: value.toISOString(),
      description:
        'ARZ-001/UC-124: watermark cursor cho cron RestrictedZoneIntrusionService — KHÔNG sửa tay.',
    });
    await repo.save(entity);
  }
}
