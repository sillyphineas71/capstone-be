# ARZ-001 — plan.md (UC-124 Alerts / SAVP: xâm nhập khu vực hạn chế)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo plan ARZ-001 cùng lượt với spec. Module mới `restricted-zone` (mirror `gate-access` Bước 2), KHÔNG DDL bảng mới, KHÔNG endpoint HTTP (cron-only). | Toàn bộ |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2. Code UC-124 SAU KHI UC-122+UC-123 xong (cần `AlertRulesService`+`AlertsService` thật).

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- `GateAccessLogEntity`/`ZonePresenceEventEntity` đã `TypeOrmModule.forFeature` sẵn trong `ZonesModule` — module mới `restricted-zone` PHẢI tự `forFeature` lại 2 entity (import class từ `../zones/entities/...`, mirror cách `gate-access` Bước 2 làm với `GateAccessLogEntity`).
- `SystemConfigEntity` — dùng đúng pattern `dataSource.getRepository(SystemConfigEntity)` (KHÔNG import `AdministrationModule`), mirror UC-116.
- `AlertRulesService.list()` (UC-122) — xác nhận method có hỗ trợ filter `zoneId IS NOT NULL` hay chỉ filter `zoneId = <giá trị cụ thể>`. Nếu KHÔNG hỗ trợ `IS NOT NULL`, `RestrictedZoneIntrusionService` tự query trực tiếp `Repository<AlertRuleEntity>` qua `@InjectRepository` (chấp nhận đụng thẳng repository ngoài `AlertRulesService`, KHÔNG vi phạm ARCH vì `alert_rules` KHÔNG phải bảng của module khác — vẫn nằm trong `alerts`, chỉ là truy cập trực tiếp thay vì qua service layer; nếu muốn sạch hơn có thể thêm method `AlertRulesService.listActiveZoneScoped(alertType)` — quyết định cụ thể ở T0 tùy method `list()` thật có gì).
- `SchedulerService`/`SchedulerModule` cấu trúc — xác nhận constructor/imports thật (mirror UC-116 T0).
- 0 migration mới ở UC-124.

## 1. Quyết định đã chốt (từ spec §1/§2)
Xem spec §2 (6 quyết định: chỉ rule zone-scoped, eventType='enter' suy luận, logic vi phạm 2 nhánh giờ/allowlist, watermark qua system_configs không quét lùi, dedup qua recordAlert có sẵn, không dùng findEffectiveRule). Constitution đầy đủ ở spec §5. Plan này KHÔNG mở lại.

## 2. Entity — KHÔNG đổi, KHÔNG migration DDL
0 thay đổi schema.

## 3. Module mới — `restricted-zone`
```
src/modules/restricted-zone/restricted-zone.module.ts
```
- `imports: [AlertsModule, TypeOrmModule.forFeature([GateAccessLogEntity, ZonePresenceEventEntity])]`.
- `providers: [RestrictedZoneIntrusionService]`.
- `controllers: []` (không có route HTTP).
- `exports: [RestrictedZoneIntrusionService]` (để `SchedulerModule` inject).

## 4. Service — `RestrictedZoneIntrusionService` (file mới)
```
src/modules/restricted-zone/services/restricted-zone-intrusion.service.ts
```
- Constructor: `@InjectRepository(GateAccessLogEntity)`, `@InjectRepository(ZonePresenceEventEntity)`, `private readonly alertRulesService: AlertRulesService`, `private readonly alertsService: AlertsService`, `private readonly dataSource: DataSource` (đọc/ghi watermark qua `system_configs`).
- `async evaluateIntrusions(): Promise<{zonesScanned, gateLogsChecked, presenceEventsChecked, violationsFound}>`:
  1. `const rules = await this.loadZoneScopedIntrusionRules();` (query trực tiếp hoặc qua service, xem §0).
  2. `const gateWatermark = await this.loadWatermark('restricted_zone.gate_log_watermark');`
  3. `const presenceWatermark = await this.loadWatermark('restricted_zone.presence_event_watermark');`
  4. `let violationsFound = 0, gateLogsChecked = 0, presenceEventsChecked = 0;`
  5. `let maxGateTime = gateWatermark, maxPresenceTime = presenceWatermark;`
  6. Với mỗi `rule` trong `rules`:
     - `const logs = await this.gateLogRepo.find({where: {zoneId: rule.zoneId, direction: 'in', accessTime: MoreThan(gateWatermark)}});`
     - `const events = await this.presenceRepo.find({where: {zoneId: rule.zoneId, eventType: 'enter', eventTime: MoreThan(presenceWatermark)}});`
     - Với mỗi `log`: `gateLogsChecked++; if (this.isViolation(rule, log.userId, log.accessTime)) { violationsFound++; await this.alertsService.recordAlert({alertType: 'intrusion', zoneId: rule.zoneId, ruleId: rule.id, payloadJson: {sourceTable: 'gate_access_logs', sourceRowId: log.id, userId: log.userId, occurredAt: log.accessTime.toISOString()}}); } if (log.accessTime > maxGateTime) maxGateTime = log.accessTime;`
     - Tương tự cho `events` (`eventTime`, `sourceTable: 'zone_presence_events'`).
  7. `await this.saveWatermark('restricted_zone.gate_log_watermark', maxGateTime);`
  8. `await this.saveWatermark('restricted_zone.presence_event_watermark', maxPresenceTime);`
  9. Trả `{zonesScanned: rules.length, gateLogsChecked, presenceEventsChecked, violationsFound}`.
- `private isViolation(rule: AlertRuleEntity, userId: string | null, occurredAt: Date): boolean`:
  - Nếu `rule.restrictedHoursJson` có giá trị VÀ `occurredAt` nằm TRONG khung (xử lý qua đêm) → `return false`.
  - Còn lại (ngoài khung HOẶC không có `restrictedHoursJson`): `userId` NULL → `return true`; `userId` có trong `rule.allowedPersonIdsJson ?? []` → `return false`; ngược lại → `return true`.
- `private isWithinAllowedHours(hours: {allowFrom: string; allowTo: string}, occurredAt: Date): boolean` — helper parse `HH:mm`, so với giờ local của `occurredAt`, xử lý case `allowFrom > allowTo` (qua đêm: trong khung nếu `time >= allowFrom OR time <= allowTo`).
- `private async loadWatermark(key: string): Promise<Date>` — đọc `system_configs` (`config_group='restricted_zone_intrusion'`), KHÔNG thấy dòng → trả `new Date()` (thời điểm gọi — KHỞI TẠO watermark = hiện tại, R5) và LƯU LUÔN dòng đó (idempotent-insert nếu chưa có, tránh watermark bị reset mỗi lần restart).
- `private async saveWatermark(key: string, value: Date): Promise<void>` — upsert `system_configs` (`config_group='restricted_zone_intrusion'`, `config_key=key`, `config_value=value.toISOString()`).
- `private async loadZoneScopedIntrusionRules(): Promise<AlertRuleEntity[]>` — tùy kết quả T0 (§0): gọi `AlertRulesService.list({alertType: 'intrusion', enabled: true})` rồi tự filter `.filter(r => r.zoneId !== null)` ở tầng code (đơn giản nhất, KHÔNG cần sửa `AlertRulesService`, chấp nhận tải hơi dư nếu có nhiều rule `intrusion` global — số lượng nhỏ, không đáng lo).

## 5. Wiring `SchedulerService` (modified)
```
src/modules/scheduler/scheduler.service.ts
src/modules/scheduler/scheduler.module.ts (thêm import RestrictedZoneModule)
```
```ts
@Cron(CronExpression.EVERY_5_MINUTES, { name: 'restricted-zone-intrusion' })
async evaluateRestrictedZoneIntrusions(): Promise<void> {
  if (!this.schedulerEnabled || !this.restrictedZoneEnabled) return;
  try {
    const r = await this.restrictedZoneIntrusionService.evaluateIntrusions();
    this.logger.log(`[Scheduler] restricted-zone-intrusion: zones=${r.zonesScanned} gateLogs=${r.gateLogsChecked} presenceEvents=${r.presenceEventsChecked} violations=${r.violationsFound}`);
  } catch (e) {
    this.logger.error(`[Scheduler] restricted-zone-intrusion failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }
}
```
- Field `restrictedZoneEnabled` đọc `SCHEDULER_RESTRICTED_ZONE_ENABLED` (default `false`).

## 6. File list
### Net-new (3 file)
- `src/modules/restricted-zone/restricted-zone.module.ts`
- `src/modules/restricted-zone/services/restricted-zone-intrusion.service.ts` (+ `.spec.ts`)
### Modified (2 file)
- `src/modules/scheduler/scheduler.service.ts`
- `src/modules/scheduler/scheduler.module.ts`
> Tổng **3 net-new + 2 modified**. 0 entity, 0 migration.

## 7. Test (mock repo — KHÔNG DB)
- `isViolation`: trong khung giờ (bất kỳ userId) → false; ngoài khung + userId trong allowlist → false; ngoài khung + userId NGOÀI allowlist → true; ngoài khung + userId NULL → true; KHÔNG có `restrictedHoursJson` + userId ngoài allowlist → true; khung giờ qua đêm (`22:00→06:00`) case biên `23:59`/`00:00`/`06:01`/`21:59`.
- `evaluateIntrusions`: gọi đúng `recordAlert` cho mỗi vi phạm, KHÔNG gọi cho case hợp lệ; watermark cập nhật đúng giá trị lớn nhất; watermark lần đầu KHÔNG quét dữ liệu cũ (R5 — assert query dùng watermark = thời điểm khởi tạo, không phải epoch).
- `loadZoneScopedIntrusionRules`: loại bỏ đúng rule `zoneId=NULL`.
- Coverage **≥80%** file mới.

## 8. Gate (STOP, KHÔNG commit)
- build=0; eslint 0 warning mới; `npx jest src/modules/restricted-zone src/modules/scheduler` xanh; coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật.
- **Owed**: xác nhận `event_type='enter'` với Hải · rule `intrusion` zoneId=NULL bị bỏ qua (cần UI cảnh báo Admin) · API xem/sửa watermark thủ công.

## 9. Kỷ luật
- **DATA-01**: KHÔNG ghi `gate_access_logs`/`zone_presence_events`.
- **PERF-01**: watermark bắt buộc, KHÔNG full-scan.
- KHÔNG tự code 3d/UC-123/UC-125 ở đây.

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md (SAU khi UC-122+UC-123 xong). KHÔNG tự code.
