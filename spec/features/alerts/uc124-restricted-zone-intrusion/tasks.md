# ARZ-001 — tasks.md (UC-124 Alerts / SAVP: xâm nhập khu vực hạn chế)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo tasks ARZ-001: T0 verify (bắt buộc UC-122+UC-123 xong) → T1 module → T2 service (evaluateIntrusions/isViolation/watermark) → T2b test → T3 wiring SchedulerService → T-GATE. | Toàn bộ |

> Map: spec.md, plan.md. **Điều kiện tiên quyết: `../uc122-alert-rules-crud/` + `../uc123-alert-center/` xong trước.**

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T-GATE.

---

## T0 — RECON-verify + xác nhận tiên quyết — plan §0
- Xác nhận `AlertRulesService`/`AlertsService` tồn tại thật (build/test xanh); `AlertRulesService.list()` filter hỗ trợ gì (quyết định cách lấy rule zone-scoped); `GateAccessLogEntity`/`ZonePresenceEventEntity` field đầy đủ; `SchedulerService` cấu trúc thật.
- **AC**: dán xác nhận đủ; thiếu tiên quyết → **DỪNG**.

## T1 — Module `restricted-zone` (code) — plan §3
- `forFeature([GateAccessLogEntity, ZonePresenceEventEntity])`, import `AlertsModule`.
- **AC**: module compile độc lập.

## T2 — Service `RestrictedZoneIntrusionService` (code) — plan §4
- `evaluateIntrusions`, `isViolation`, `isWithinAllowedHours`, `loadWatermark`, `saveWatermark`, `loadZoneScopedIntrusionRules`.
- **AC**: 6 method; `isViolation` đúng bảng quyết định spec §2.3; watermark khởi tạo = hiện tại (KHÔNG quét lùi, R5).

## T2b — Test — plan §7
- Đủ case `isViolation` (bao gồm qua đêm) + `evaluateIntrusions` (gọi đúng recordAlert, watermark cập nhật đúng) + `loadZoneScopedIntrusionRules` loại rule global.
- **AC**: toàn bộ nhánh xanh; coverage ≥80%.

## T3 — Wiring `SchedulerService` (code) — plan §5
- Method `evaluateRestrictedZoneIntrusions`, field `restrictedZoneEnabled`, `scheduler.module.ts` import `RestrictedZoneModule`.
- **AC**: `AppModule` compile được (DI-proof); job cron cũ KHÔNG hồi quy.

## T-GATE — (STOP, KHÔNG commit) — plan §8
- build=0; eslint 0 warning mới; `npx jest src/modules/restricted-zone src/modules/scheduler` xanh; coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật, KHÔNG commit.
- In: code 3 file mới + 2 file modified + jest + coverage + báo cáo gate.
- **Owed**: xác nhận `event_type='enter'` với Hải · rule global bị bỏ qua (cần UI cảnh báo) · API xem/sửa watermark.
- **AC**: bảng gate đầy đủ + báo cáo: chỉ quét rule zone-scoped enabled ✓ · logic vi phạm đúng 2 nhánh giờ/allowlist ✓ · watermark không quét lùi lịch sử ✓ · dedup qua recordAlert có sẵn (không tự chế) ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC-124
- T0 → verify RECON + tiên quyết UC-122/123
- T1 → module restricted-zone
- T2/T2b → service evaluateIntrusions + isViolation + watermark
- T3 → wiring SchedulerService
- T-GATE → gate + STOP + Owed
