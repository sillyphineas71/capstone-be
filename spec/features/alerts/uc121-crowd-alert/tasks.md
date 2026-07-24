# ACR-001 — tasks.md (UC-121 Alerts / SAVP: cảnh báo tụ tập đông người)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo tasks ACR-001: T0 verify → T1 module → T2 service (evaluateCrowdAlerts/loadZoneScopedCrowdRules/watermark) → T2b test → T3 wiring SchedulerService → T-GATE. | Toàn bộ |

> Map: spec.md, plan.md. **Điều kiện tiên quyết: `../uc122-alert-rules-crud/` + `../uc123-alert-center/` xong trước (đã xong).**

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T-GATE.

---

## T0 — RECON-verify + xác nhận tiên quyết — plan §0
- Xác nhận `AlertRulesService`/`AlertsService` tồn tại thật (build/test xanh — đã xác nhận ở UC-124); `ZonePresenceEventEntity` field đầy đủ; `SchedulerService` cấu trúc thật.
- **AC**: dán xác nhận đủ; thiếu tiên quyết → **DỪNG**.

## T1 — Module `crowd-alert` (code) — plan §3
- `forFeature([ZonePresenceEventEntity])`, import `AlertsModule`.
- **AC**: module compile độc lập.

## T2 — Service `CrowdAlertService` (code) — plan §4
- `evaluateCrowdAlerts`, `loadZoneScopedCrowdRules`, `loadWatermark`, `saveWatermark` (2 method watermark copy nguyên văn từ `RestrictedZoneIntrusionService`, đổi `CONFIG_GROUP`).
- **AC**: 4 method; so sánh ngưỡng dùng `>` (không phải `>=`, spec §2.3); rule `threshold=NULL` bị loại; watermark khởi tạo = hiện tại (KHÔNG quét lùi).

## T2b — Test — plan §7
- Đủ case biên `>`/`<=`/`==` ngưỡng + rule bị loại (`zoneId=NULL`, `threshold=NULL`) + watermark cập nhật đúng + watermark lần đầu không quét lùi.
- **AC**: toàn bộ nhánh xanh; coverage ≥80%.

## T3 — Wiring `SchedulerService` (code) — plan §5
- Method `evaluateCrowdAlerts`, field `crowdAlertEnabled`, `scheduler.module.ts` import `CrowdAlertModule`, cập nhật dòng log khởi tạo.
- **AC**: `AppModule` compile được (DI-proof); job cron cũ (bao gồm `restricted-zone-intrusion`) KHÔNG hồi quy.

## T-GATE — (STOP, KHÔNG commit) — plan §8
- build=0; eslint 0 warning mới; `npx jest src/modules/crowd-alert src/modules/scheduler` xanh; coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật, KHÔNG commit.
- In: code 3 file mới + 2 file modified + jest + coverage + báo cáo gate.
- **Owed**: fix `CreateAlertRuleDto.threshold` bắt buộc theo `alertType` (residual UC-122) · UI cảnh báo Admin rule `crowd` không gắn zone.
- **AC**: bảng gate đầy đủ + báo cáo: chỉ quét rule zone-scoped enabled có threshold ✓ · so sánh ngưỡng đúng `>` ✓ · watermark không quét lùi lịch sử ✓ · dedup qua recordAlert có sẵn (deviation đã ghi rõ, không tự chế thêm) ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC-121
- T0 → verify RECON + tiên quyết UC-122/123 (đã xong)
- T1 → module crowd-alert
- T2/T2b → service evaluateCrowdAlerts + loadZoneScopedCrowdRules + watermark
- T3 → wiring SchedulerService
- T-GATE → gate + STOP + Owed
