# ACR-001 — plan.md (UC-121 Alerts / SAVP: cảnh báo tụ tập đông người)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo plan ACR-001 cùng lượt với spec. Module mới `crowd-alert` (mirror `restricted-zone` Bước 3f), KHÔNG DDL bảng mới, KHÔNG endpoint HTTP (cron-only). | Toàn bộ |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- `ZonePresenceEventEntity` đã `TypeOrmModule.forFeature` sẵn trong `ZonesModule` — module mới `crowd-alert` PHẢI tự `forFeature` lại (import class từ `../zones/entities/zone-presence-event.entity.js`), mirror cách `restricted-zone` làm.
- `SystemConfigEntity` — dùng đúng pattern `dataSource.getRepository(SystemConfigEntity)`, mirror UC-124.
- `AlertRulesService.list()` — xác nhận lại (đã dùng ở UC-124) hỗ trợ filter `alertType`/`enabled`; filter `zoneId IS NOT NULL` và `threshold IS NOT NULL` làm ở tầng code (`.filter(...)`) giống UC-124 (KHÔNG sửa `AlertRulesService`).
- `SchedulerService`/`SchedulerModule` — xác nhận constructor/imports thật, thêm field `crowdAlertEnabled` + method mới.
- 0 migration mới.

## 1. Quyết định đã chốt (từ spec §1/§2)
Xem spec §2 (6 quyết định: chỉ rule zone-scoped, deviation dedup đã chốt dùng recordAlert nguyên vẹn, so sánh `>` ngưỡng, bỏ qua threshold NULL, watermark 1 key, tần suất EVERY_MINUTE). Constitution đầy đủ ở spec §5. Plan này KHÔNG mở lại.

## 2. Entity — KHÔNG đổi, KHÔNG migration DDL
0 thay đổi schema.

## 3. Module mới — `crowd-alert`
```
src/modules/crowd-alert/crowd-alert.module.ts
```
- `imports: [AlertsModule, TypeOrmModule.forFeature([ZonePresenceEventEntity])]`.
- `providers: [CrowdAlertService]`.
- `controllers: []` (không có route HTTP).
- `exports: [CrowdAlertService]` (để `SchedulerModule` inject).

## 4. Service — `CrowdAlertService` (file mới)
```
src/modules/crowd-alert/services/crowd-alert.service.ts
```
- Constructor: `@InjectRepository(ZonePresenceEventEntity)`, `private readonly alertRulesService: AlertRulesService`, `private readonly alertsService: AlertsService`, `private readonly dataSource: DataSource`.
- `async evaluateCrowdAlerts(): Promise<{zonesScanned, eventsChecked, violationsFound}>`:
  1. `const rules = await this.loadZoneScopedCrowdRules();` (filter `zoneId !== null && threshold !== null`).
  2. `const watermark = await this.loadWatermark('crowd_alert.count_event_watermark');`
  3. `let violationsFound = 0, eventsChecked = 0; let maxTime = watermark;`
  4. Với mỗi `rule` trong `rules`:
     - `const events = await this.presenceRepo.find({where: {zoneId: rule.zoneId, eventType: 'count', eventTime: MoreThan(watermark)}});`
     - Với mỗi `event`: `eventsChecked++; if ((event.occupancyCount ?? 0) > (rule.threshold as number)) { violationsFound++; await this.alertsService.recordAlert({alertType: 'crowd', zoneId: rule.zoneId, ruleId: rule.id, payloadJson: {occupancyCount: event.occupancyCount, threshold: rule.threshold, sourceEventId: event.id, occurredAt: event.eventTime.toISOString()}}); } if (event.eventTime > maxTime) maxTime = event.eventTime;`
  5. `await this.saveWatermark('crowd_alert.count_event_watermark', maxTime);`
  6. Trả `{zonesScanned: rules.length, eventsChecked, violationsFound}`.
- `private async loadZoneScopedCrowdRules(): Promise<AlertRuleEntity[]>` — `AlertRulesService.list({alertType: 'crowd', enabled: true, page: 1, limit: 500, sortBy: 'createdAt', sortOrder: 'desc'})` rồi `.filter(r => r.zoneId !== null && r.threshold !== null)` — mirror UC-124 §T2 (KHÔNG cần sửa `AlertRulesService`).
- `private async loadWatermark(key: string): Promise<Date>` / `private async saveWatermark(key: string, value: Date): Promise<void>` — COPY NGUYÊN VĂN 2 method của `RestrictedZoneIntrusionService` (đổi `CONFIG_GROUP = 'crowd_alert'`), KHÔNG viết lại từ đầu — tránh drift logic giữa 2 cron cùng pattern.

## 5. Wiring `SchedulerService` (modified)
```
src/modules/scheduler/scheduler.service.ts
src/modules/scheduler/scheduler.module.ts (thêm import CrowdAlertModule)
```
```ts
@Cron(CronExpression.EVERY_MINUTE, { name: 'crowd-alert' })
async evaluateCrowdAlerts(): Promise<void> {
  if (!this.schedulerEnabled || !this.crowdAlertEnabled) return;
  try {
    const r = await this.crowdAlertService.evaluateCrowdAlerts();
    this.logger.log(`[Scheduler] crowd-alert: zones=${r.zonesScanned} events=${r.eventsChecked} violations=${r.violationsFound}`);
  } catch (e) {
    this.logger.error(`[Scheduler] crowd-alert failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }
}
```
- Field `crowdAlertEnabled` đọc `SCHEDULER_CROWD_ALERT_ENABLED` (default `false`).
- Cập nhật dòng log khởi tạo `SchedulerService` (thêm `crowd-alert=${this.crowdAlertEnabled}` vào chuỗi log hiện có, mirror cách `restricted-zone` đã nối vào).

## 6. File list
### Net-new (3 file)
- `src/modules/crowd-alert/crowd-alert.module.ts`
- `src/modules/crowd-alert/services/crowd-alert.service.ts` (+ `.spec.ts`)
### Modified (2 file)
- `src/modules/scheduler/scheduler.service.ts`
- `src/modules/scheduler/scheduler.module.ts`
> Tổng **3 net-new + 2 modified**. 0 entity, 0 migration.

## 7. Test (mock repo — KHÔNG DB)
- `evaluateCrowdAlerts`: gọi đúng `recordAlert` khi `occupancyCount > threshold`; KHÔNG gọi khi `occupancyCount <= threshold`; KHÔNG gọi khi `occupancyCount == threshold` (biên `>` không phải `>=`); bỏ qua rule `threshold=NULL`; bỏ qua rule `zoneId=NULL`; watermark cập nhật đúng giá trị lớn nhất; watermark lần đầu KHÔNG quét dữ liệu cũ.
- `loadZoneScopedCrowdRules`: loại đúng rule `zoneId=NULL` VÀ rule `threshold=NULL`.
- Coverage **≥80%** file mới.

## 8. Gate (STOP, KHÔNG commit)
- build=0; eslint 0 warning mới; `npx jest src/modules/crowd-alert src/modules/scheduler` xanh; coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật.
- **Owed**: fix `CreateAlertRuleDto.threshold` bắt buộc theo `alertType` (residual UC-122, không làm ở đây) · UI cảnh báo Admin khi tạo rule `crowd` không gắn zone.

## 9. Kỷ luật
- **DATA-01**: KHÔNG ghi `zone_presence_events`.
- **PERF-01**: watermark bắt buộc, tận dụng `IDX_zpe_count`, KHÔNG full-scan.
- KHÔNG tự code UC-119/120/126 ở đây.

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md. KHÔNG tự code.
