import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { ZonePresenceEventEntity } from '../../zones/entities/zone-presence-event.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import { AlertRuleEntity } from '../../alerts/entities/alert-rule.entity.js';
import { AlertRulesService } from '../../alerts/services/alert-rules.service.js';
import { AlertsService } from '../../alerts/services/alerts.service.js';

const CONFIG_GROUP = 'crowd_alert';
const COUNT_EVENT_WATERMARK_KEY = 'crowd_alert.count_event_watermark';
import { ZONE_PRESENCE_EVENT_TYPES } from '../../zones/constants/zone-presence-event-type.constant.js';

export interface EvaluateCrowdAlertsResult {
  zonesScanned: number;
  eventsChecked: number;
  violationsFound: number;
}

/**
 * CrowdAlertService (ACR-001 / UC-121) — cron đối chiếu `zone_presence_events`
 * (`event_type='count'`, tận dụng `IDX_zpe_count`) với `alert_rules`
 * (`alert_type='crowd'`, GẮN ZONE CỤ THỂ) để phát hiện tụ tập đông người.
 *
 * DATA-01: KHÔNG ghi `zone_presence_events` (append-only, chỉ đọc).
 * PERF-01: watermark cursor qua `system_configs` — KHÔNG full-scan mỗi lần chạy.
 * Dedup dùng NGUYÊN `recordAlert()` có sẵn (UC-123) — deviation so với chữ SRS EX1 đã
 * chốt + ghi rõ trong spec §2.2, KHÔNG tự chế state-tracking riêng ở đây.
 */
@Injectable()
export class CrowdAlertService {
  private readonly logger = new Logger(CrowdAlertService.name);

  constructor(
    @InjectRepository(ZonePresenceEventEntity)
    private readonly presenceRepo: Repository<ZonePresenceEventEntity>,
    private readonly alertRulesService: AlertRulesService,
    private readonly alertsService: AlertsService,
    private readonly dataSource: DataSource,
  ) {}

  async evaluateCrowdAlerts(): Promise<EvaluateCrowdAlertsResult> {
    const rules = await this.loadZoneScopedCrowdRules();
    const watermark = await this.loadWatermark(COUNT_EVENT_WATERMARK_KEY);

    let eventsChecked = 0;
    let violationsFound = 0;
    let maxTime = watermark;

    for (const rule of rules) {
      const zoneId = rule.zoneId as string; // đã filter zoneId !== null ở loadZoneScopedCrowdRules
      const threshold = rule.threshold as number; // đã filter threshold !== null

      const events = await this.presenceRepo.find({
        where: {
          zoneId,
          eventType: ZONE_PRESENCE_EVENT_TYPES[2],
          eventTime: MoreThan(watermark),
        },
      });

      for (const event of events) {
        eventsChecked++;
        if (this.isThresholdExceeded(rule, event.occupancyCount ?? 0)) {
          violationsFound++;
          await this.recordCrowdAlert(rule, {
            occupancyCount: event.occupancyCount,
            threshold,
            sourceEventId: event.id,
            occurredAt: event.eventTime.toISOString(),
          });
        }
        if (event.eventTime > maxTime) maxTime = event.eventTime;
      }
    }

    await this.saveWatermark(COUNT_EVENT_WATERMARK_KEY, maxTime);

    this.logger.debug(
      `evaluateCrowdAlerts: zones=${rules.length} events=${eventsChecked} violations=${violationsFound}`,
    );

    return {
      zonesScanned: rules.length,
      eventsChecked,
      violationsFound,
    };
  }

  /**
   * Đường TỨC THỜI (bên cạnh cron `evaluateCrowdAlerts()` — KHÔNG thay thế, cron
   * vẫn chạy làm lưới quét bù). Gọi ngay sau khi 1 count-event (`zone_presence_events
   * .event_type='count'`) được ghi, để cảnh báo xuất hiện ngay thay vì đợi chu kỳ
   * cron. `isThresholdExceeded()` thuần tuý, không phụ thuộc watermark → gọi trực
   * tiếp an toàn.
   *
   * Chỉ tải rule của ĐÚNG zoneId (`AlertRulesService.list()` có sẵn filter `zoneId`)
   * — KHÔNG dùng `loadZoneScopedCrowdRules()` (tải TẤT CẢ zone rồi lọc JS, tốn cho
   * đường per-event). Mirror `RestrictedZoneIntrusionService.evaluateZoneEventNow()`.
   *
   * Dedupe: KHÔNG thêm cờ "đã xử lý tức thời" — dựa hoàn toàn vào
   * `AlertsService.recordAlert()` (unique index mở theo alertType+zoneId, §UC-123).
   * Cron quét lại đúng event này sau đó chỉ bump `occurrenceCount`, KHÔNG tạo alert
   * thứ 2.
   */
  async evaluateZoneCountNow(args: {
    zoneId: string;
    occupancyCount: number;
    eventTime: Date;
    sourceEventId: string;
  }): Promise<boolean> {
    const { items: rules } = await this.alertRulesService.list({
      alertType: 'crowd',
      zoneId: args.zoneId,
      enabled: true,
      page: 1,
      limit: 50,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    let violated = false;
    for (const rule of rules) {
      if (rule.threshold === null) continue; // mirror loadZoneScopedCrowdRules
      if (this.isThresholdExceeded(rule, args.occupancyCount)) {
        violated = true;
        await this.recordCrowdAlert(rule, {
          occupancyCount: args.occupancyCount,
          threshold: rule.threshold,
          sourceEventId: args.sourceEventId,
          occurredAt: args.eventTime.toISOString(),
        });
      }
    }
    return violated;
  }

  /** isThresholdExceeded (spec §2.4) — thuần tuý, tách khỏi vòng lặp cron để tái dùng cho đường tức thời. */
  private isThresholdExceeded(
    rule: AlertRuleEntity,
    occupancyCount: number,
  ): boolean {
    const threshold = rule.threshold as number; // caller đảm bảo threshold !== null
    return occupancyCount >= threshold;
  }

  private async recordCrowdAlert(
    rule: AlertRuleEntity,
    payloadJson: Record<string, unknown>,
  ): Promise<void> {
    await this.alertsService.recordAlert({
      alertType: 'crowd',
      zoneId: rule.zoneId,
      ruleId: rule.id,
      payloadJson,
    });
  }

  /** Chỉ rule crowd GẮN ZONE CỤ THỂ VÀ đã cấu hình threshold (spec §2.1/§2.4). */
  private async loadZoneScopedCrowdRules(): Promise<AlertRuleEntity[]> {
    const { items } = await this.alertRulesService.list({
      alertType: 'crowd',
      enabled: true,
      page: 1,
      limit: 500,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    return items.filter((r) => r.zoneId !== null && r.threshold !== null);
  }

  /**
   * loadWatermark — KHÔNG có dòng → khởi tạo = thời điểm HIỆN TẠI (KHÔNG quét lùi dữ
   * liệu lịch sử) và lưu luôn (tránh reset watermark mỗi lần restart process). Mirror
   * `RestrictedZoneIntrusionService`.
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
        'ACR-001/UC-121: watermark cursor cho cron CrowdAlertService — KHÔNG sửa tay.',
    });
    await repo.save(entity);
  }
}
