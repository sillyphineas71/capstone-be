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
        if ((event.occupancyCount ?? 0) > threshold) {
          violationsFound++;
          await this.alertsService.recordAlert({
            alertType: 'crowd',
            zoneId,
            ruleId: rule.id,
            payloadJson: {
              occupancyCount: event.occupancyCount,
              threshold,
              sourceEventId: event.id,
              occurredAt: event.eventTime.toISOString(),
            },
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
