# PWL-001 — tasks.md (UC-125 Alerts / SAVP: watchlist người)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo tasks PWL-001: T0 verify (bắt buộc UC-122+UC-123 xong) → T1 DTO → T2 CRUD service → T2b test → T3 check service → T3b test → T4 controller → T4b test → T5 enum notification → T6 migration permission → T7 wiring → T-GATE. | Toàn bộ |
| 2026-07-23 | Đánh số lại migration timestamp (phát hiện `LO_TRINH_SAVP_TAI.md` đã cập nhật: `20260723000004` thật đang dùng cho `SeedGateAccessDemoLogsForVerify` của Bước 2 verify, không còn trống như lúc viết spec ban đầu) — UC-122 dời `000004→000005`, UC-123 `000005→000006`, UC-125 `000006→000007`. | Toàn bộ mục tham chiếu timestamp |

> Map: spec.md, plan.md. **Điều kiện tiên quyết: `../uc122-alert-rules-crud/` + `../uc123-alert-center/` xong trước.**

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T3b → T4 → T4b → T5 → T6 → T7 → T-GATE.

---

## T0 — RECON-verify + xác nhận tiên quyết — plan §0
- Xác nhận `AlertRulesService.findEffectiveRule`/`AlertsService.recordAlert` tồn tại thật; `NotificationsService.createNotification` chữ ký thật; vị trí enum `NotificationType`; migration mới nhất `20260723000006`.
- **AC**: dán xác nhận đủ; thiếu tiên quyết → **DỪNG**.

## T1 — DTO (code) — plan §3
- 3 file DTO đúng plan §3.
- **AC**: validate đủ field, `update` dùng `PartialType`.

## T2 — Service `PersonControlListService` (code) — plan §4
- `create`, `list`, `findOne`, `update`, `remove`, `isUniqueViolation`.
- **AC**: dedup 2 nhánh ĐỘC LẬP (KHÔNG else-if) đúng spec §2.6/R1/R2.

## T2b — Test CRUD — plan §11
- Case dedup 2 nhánh độc lập, displayName-only tự do, 23505.
- **AC**: toàn bộ nhánh xanh; coverage ≥80%.

## T3 — Service `PersonWatchlistCheckService` (code) — plan §5
- `checkPersonWatchlist`, `resolveRecipients`, throttle in-memory.
- **AC**: NotThrow toàn bộ (try/catch bọc TOÀN BỘ thân hàm, KHÔNG chỉ 1 đoạn); severity = match.priority TRỰC TIẾP (KHÔNG qua bảng mapping).

## T3b — Test check service — plan §11
- 5 case: no-match / throttle / suppressed / thành công / lỗi bất kỳ bước → NotThrow.
- **AC**: toàn bộ nhánh xanh; coverage ≥80%.

## T4 — Controller `PersonControlListController` (code) — plan §6
- 5 route mirror `VehicleControlListController`.
- **AC**: route + `@RequirePermissions` đúng plan §6.

## T4b — Test controller — plan §11
- Assert route gate qua reflect metadata.
- **AC**: coverage ≥80%.

## T5 — Sửa enum `NotificationType` (code) — plan §7
- Thêm `PERSON_WATCHLIST_MATCH`.
- **AC**: enum cũ KHÔNG đổi giá trị/thứ tự, chỉ thêm dòng mới; test enum cũ KHÔNG hồi quy.

## T6 — Migration seed permission (code) — plan §8
- `20260723000007-SeedPersonControlListPermissions.ts`.
- **AC**: idempotent; role mapping đúng spec §2.2.

## T7 — Wiring `AlertsModule` (code) — plan §9
- Thêm 2 service + controller vào module.
- **AC**: `AppModule` compile được (DI-proof); `PersonWatchlistCheckService` export cho `face-access` import sau (ngoài phạm vi wiring thật).

## T-GATE — (STOP, KHÔNG commit) — plan §12
- build=0; eslint 0 warning mới; `npx jest src/modules/alerts src/modules/notifications` xanh; coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật, KHÔNG commit.
- In: code 7 file mới + 2 file modified + jest + coverage + báo cáo gate.
- **Owed**: đối chiếu theo `faceProfileId` · `zoneId` null cố định · wiring face-access (thuộc Hải).
- **AC**: bảng gate đầy đủ + báo cáo: dedup 2 nhánh độc lập ✓ · checkPersonWatchlist NotThrow toàn bộ ✓ · severity=priority trực tiếp ✓ · enum notification không hồi quy ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC-125
- T0 → verify RECON + tiên quyết UC-122/123
- T1 → DTO
- T2/T2b → CRUD service
- T3/T3b → check service (checkPersonWatchlist)
- T4/T4b → controller
- T5 → enum notification
- T6 → migration seed permission
- T7 → wiring AlertsModule
- T-GATE → gate + STOP + Owed
