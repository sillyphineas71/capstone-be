# ASC-001 — tasks.md (UC-123 Alerts / SAVP: Trung tâm cảnh báo — engine + API)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo tasks ASC-001: T0 verify → T1 DTO → T2 recordAlert (engine) → T2b test → T3 read/action API → T3b test → T4 migration permission → T5 wiring → T-GATE. Code cụm này PHẢI sau UC-122 (đụng chung alerts.module.ts). | Toàn bộ |
| 2026-07-23 | Đánh số lại migration timestamp (phát hiện `LO_TRINH_SAVP_TAI.md` đã cập nhật: `20260723000004` thật đang dùng cho `SeedGateAccessDemoLogsForVerify` của Bước 2 verify, không còn trống như lúc viết spec ban đầu) — UC-122 dời `000004→000005`, UC-123 `000005→000006`, UC-125 `000006→000007`. | Toàn bộ mục tham chiếu timestamp |

> Map: spec.md, plan.md. Thứ tự code thực tế: UC-122 xong trước, rồi mới UC-123 (plan §8 đã ghi rõ lý do).

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T3b → T4 → T5 → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận: `SecurityAlertEntity` field đầy đủ; UC-122 (`AlertRulesService`/`alerts.module.ts`) ĐÃ code xong và merge trước khi bắt đầu T1 (tránh conflict file); migration mới nhất đúng `20260723000005` (không trùng `20260723000006`); `Repository.update()` trả `UpdateResult.affected` đúng như kỳ vọng (test nhanh 1 case cục bộ nếu chưa chắc).
- **AC**: dán xác nhận đủ 4 mục; UC-122 CHƯA xong → **DỪNG**, không code song song đè file.

## T1 — DTO (code) — plan §3
- 4 file DTO/interface đúng plan §3.
- **AC**: `RecordAlertInput` là interface thuần (không decorator) vì không qua HTTP boundary; 3 DTO còn lại có validate đầy đủ.

## T2 — Service `AlertsService` — engine `recordAlert` (code) — plan §4
- `DEFAULT_SEVERITY_BY_TYPE`, `resolveSeverity`, `recordAlert` (INSERT → catch 23505 → UPDATE occurrenceCount, 2 nhánh zoneId, retry 1 lần khi race hiếm), `isUniqueViolation`.
- **AC**: `recordAlert` KHÔNG bao giờ throw ra ngoài trừ lỗi DB thật (không phải 23505) hoặc race retry vẫn fail; severity/triggeredAt giữ nguyên khi gia hạn.

## T2b — Test engine `recordAlert` — plan §9
- Đủ case: INSERT mới / 23505→UPDATE (2 nhánh zoneId) / severity giữ nguyên / retry-once / resolveSeverity 3 nhánh (override/map/fallback).
- **AC**: toàn bộ nhánh xanh; coverage phần engine ≥80%.

## T3 — Service + Controller — read/action API (code) — plan §4/§5
- `list`, `findOne` (+ `history` raw query `IS NOT DISTINCT FROM`), `acknowledge`, `resolve`, `bulkAcknowledge`; 5 route controller đúng `@RequirePermissions`.
- **AC**: conditional update dùng `affected` để phát hiện conflict (KHÔNG select-rồi-update); message 409 phân biệt đúng `acknowledgedBy` vs `resolvedBy` theo trạng thái hiện tại; `bulkAcknowledge` 1 lỗi KHÔNG chặn các id khác.

## T3b — Test read/action API — plan §9
- `acknowledge`/`resolve` thành công + conflict đúng message; `bulkAcknowledge` mix case; `history` case `zoneId NULL`; `list` filter + sort mặc định.
- **AC**: toàn bộ nhánh xanh; coverage phần API ≥80%.

## T4 — Migration seed permission (code) — plan §6
- `20260723000006-SeedSecurityAlertPermissions.ts`: 3 entry, role `MANAGER,BUSINESS_ADMIN,SYSTEM_ADMIN`.
- **AC**: `up()` idempotent; `down()` chỉ xóa đúng 3 permission này.

## T5 — Wiring `AlertsModule` (code) — plan §7
- Thêm `AlertsService`/`AlertsController` vào module đã có `AlertRulesService`/`AlertRulesController` từ UC-122.
- **AC**: `AppModule` compile được (DI-proof); `AlertsService` export cho 3d/UC-124/UC-125 import sau.

## T-GATE — (STOP, KHÔNG commit) — plan §10
- build=0; eslint 0 warning mới; `npx jest src/modules/alerts` xanh (KHÔNG hồi quy test UC-122); coverage ≥80% file mới; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật, KHÔNG commit.
- In: code đầy đủ 8 file mới + 1 file modified + jest + coverage + báo cáo gate.
- **Owed**: WebSocket push realtime · ảnh chưa đảm bảo trong payload · `zoneId` NULL vehicle alert (chờ Hải).
- **AC**: bảng gate đầy đủ + báo cáo: dedup 23505 đúng 2 nhánh ✓ · severity mapping đúng bảng ✓ · acknowledge/resolve conditional-update đúng EX1 ✓ · bulk không vỡ batch khi lỗi 1 phần tử ✓ · history IS NOT DISTINCT FROM đúng ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC-123
- T0 → verify RECON + xác nhận UC-122 đã xong
- T1 → DTO
- T2/T2b → engine recordAlert (hạt nhân dùng chung)
- T3/T3b → read/action API (list/detail/acknowledge/resolve/bulk)
- T4 → migration seed permission
- T5 → wiring AlertsModule
- T-GATE → gate + STOP + Owed
