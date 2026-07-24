# ARL-001 — tasks.md (UC-122 Alerts / SAVP: CRUD alert_rules)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo tasks ARL-001: T0 verify → T1 DTO → T2 service (create/list/findOne/update/remove/findActiveRule) → T2b test → T3 controller → T3b test → T4 migration permission → T5 wiring AlertsModule → T-GATE. Viết cùng lượt với spec/plan do OQ đã chốt trước. | Toàn bộ |
| 2026-07-23 | T2/T2b bổ sung `findEffectiveRule` (đồng bộ spec §2.8/§4/R10, plan §4). | T2, T2b |
| 2026-07-23 | Đánh số lại migration timestamp (phát hiện `LO_TRINH_SAVP_TAI.md` đã cập nhật: `20260723000004` thật đang dùng cho `SeedGateAccessDemoLogsForVerify` của Bước 2 verify, không còn trống như lúc viết spec ban đầu) — UC-122 dời `000004→000005`, UC-123 `000005→000006`, UC-125 `000006→000007`. | Toàn bộ mục tham chiếu timestamp |

> Map: spec.md, plan.md. Mỗi task 1 AC. Code vs test tách.

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T3b → T4 → T5 → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận đọc CODE THẬT: `AlertRuleEntity` field đầy đủ; `RequirePermissions`/`PermissionsGuard`/`JwtAuthGuard` đường dẫn thật; `@CurrentUser()` decorator đường dẫn thật; migration mới nhất đúng là `20260723000003` (không trùng `20260723000005`); `permissions.permission_code` KHÔNG có unique constraint (dùng `WHERE NOT EXISTS`, không phải `ON CONFLICT`).
- **AC**: dán xác nhận đủ 5 mục; thiếu/sai → **DỪNG báo Thiếu Chủ**, không bịa.

## T1 — DTO (code) — plan §3
- 3 file DTO: `create-alert-rule.dto.ts`, `update-alert-rule.dto.ts`, `query-alert-rules.dto.ts` đúng rule validate spec §2.1-2.3/2.6-2.7.
- **AC**: `class-validator` decorator đủ cho từng field; `update` dùng `PartialType`.

## T2 — Service `AlertRulesService` (code) — plan §4
- `create`, `list`, `findOne`, `update`, `remove`, `findActiveRule`, `findEffectiveRule`, `isUniqueViolation` đúng plan §4.
- **AC**: 8 method; `create`/`update` đều có safety-net bắt `23505`; `findActiveRule` đúng thứ tự ưu tiên zone → global (BR2); `findEffectiveRule` đúng 3 nhánh (enabled/disabled tường minh/chưa cấu hình fail-open — spec R10).

## T2b — Service test (mock repo) — plan §9
- Đủ case conflict zone/global/thành công/23505; update re-check đúng điều kiện; findActiveRule 4 case (zone+global cùng bật / chỉ global / rule tắt / không rule).
- **AC**: toàn bộ nhánh xanh; coverage service ≥80%.

## T3 — Controller `AlertRulesController` (code) — plan §5
- 5 route đúng `@RequirePermissions`, response format chuẩn `success/message/data/meta`.
- **AC**: route map đúng plan §5; guard đúng thứ tự `JwtAuthGuard` → `PermissionsGuard`.

## T3b — Controller test — plan §9
- Assert route gate qua reflect metadata (mirror `vehicle-registration.controller.spec.ts`); assert service được gọi đúng tham số.
- **AC**: 5 route đều có test gate; coverage controller ≥80%.

## T4 — Migration seed permission (code) — plan §6
- `20260723000005-SeedAlertRulesPermissions.ts`: 4 entry, role mapping đúng spec §2.4.
- **AC**: `up()` chạy 2 lần không lỗi/không trùng; `down()` chỉ xóa đúng 4 permission này.

## T5 — Wiring `AlertsModule` (code) — plan §7
- Thêm `providers`/`controllers`/`exports` đúng plan §7.
- **AC**: `AppModule` compile được (DI-proof); `AlertRulesService` export được cho module khác import sau này.

## T-GATE — (STOP, KHÔNG commit) — plan §10
- build=0; eslint file mới/touched 0 warning mới; `npx jest src/modules/alerts` xanh; coverage ≥80% file mới; DI-proof compile `AppModule`. KHÔNG live, KHÔNG DB thật, KHÔNG commit.
- In: code đầy đủ 6 file mới + 1 file modified + jest + coverage + báo cáo gate.
- **Owed (ghi, KHÔNG chạy)**: validate FK thật `allowed_person_ids_json` với `users` · CHECK constraint DB cho `alert_type`.
- **AC**: bảng gate đầy đủ + báo cáo: conflict 2 nhánh zone/global ✓ · 23505 safety-net ✓ · findActiveRule đúng BR2 override ✓ · permission đúng role mapping ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC-122
- T0 → verify RECON đủ để code
- T1 → DTO
- T2/T2b → service CRUD + findActiveRule
- T3/T3b → controller + route gate
- T4 → migration seed permission
- T5 → wiring AlertsModule
- T-GATE → gate + STOP + Owed
