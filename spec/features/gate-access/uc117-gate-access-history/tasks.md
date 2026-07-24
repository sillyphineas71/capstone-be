# GAH-001 — tasks.md (UC-117 Gate Access / SAVP: tra cứu lịch sử ra vào cổng)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | **[REVISE]** Viết lại T2/T2b theo raw SQL self-join (1 dòng/1 phiên) thay vì QueryBuilder (1 dòng/1 log thô). Thêm AC kiểm tra KHÔNG trùng dòng cho phiên hoàn tất + đúng `SESSION_FILTER` ở cả 4 method. T0/T1/T3/T3b/T4/T5/T-GATE cấu trúc giữ nguyên, nội dung field đổi theo spec/plan mới. | Toàn bộ (rewrite) |
| 2026-07-23 | Tạo tasks GAH-001 bản đầu (QueryBuilder, sai shape) — đã thay thế. | (đã thay thế ở dòng trên) |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Phụ thuộc module `gate-access` (GAP-001). Mỗi task 1 AC. Code vs test tách.

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T3b → T4 → T5 → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận tên cột thật (snake_case) của `gate_access_logs`/`zones`/`users` dùng trong raw SQL; xác nhận driver `pg` tự parse `jsonb` (`metadata_json`) thành JS object khi đọc qua `dataSource.manager.query`; module `gate-access` (GAP-001) đã tồn tại; migration mới nhất `20260723000001` (GAH-001 dùng `20260723000002`, KHÔNG đổi); 4 role lõi tồn tại.
- **AC**: dán xác nhận đủ 5 mục; thiếu/sai → **DỪNG báo Thiếu Chủ**.

## T1 — DTO ×4 (code) — plan §4
- `list-gate-access-history-query.dto.ts`: KHÔNG đổi so với bản trước.
- `list-gate-access-history-admin-query.dto.ts`: KHÔNG đổi.
- `gate-access-history-item-response.dto.ts`: đổi field — `check_in_time`, `check_out_time` (nullable) thay cho `direction`/`access_time`.
- `gate-access-history-detail-response.dto.ts`: extends item + `image_url`.
- **AC**: 4 DTO đúng field theo spec §4 (đã đổi field so với bản đầu).

## T2 — Service `GateAccessHistoryService` (code) — plan §5
- Constructor CHỈ nhận `DataSource` (KHÔNG `@InjectRepository`).
- `BASE_SELECT`/`BASE_SELECT_WITH_USER` (const string, self-join `paired`, LEFT JOIN `zones` kèm `deleted_at IS NULL`, biến thể có JOIN `users`).
- `SESSION_FILTER` const (`(l.direction = 'in' OR l.paired_log_id IS NULL)`).
- `buildWhere(query, extraConditions)`: gộp `SESSION_FILTER` + `extraConditions` + filter `from`/`to`/`zoneId` động, bind param nối tiếp ĐÚNG THỨ TỰ.
- `listForUser`/`listAll`: COUNT (không JOIN) + SELECT phân trang (`LIMIT`/`OFFSET` push SAU CÙNG params).
- `getDetailForUser`/`getDetailAny`: `SESSION_FILTER AND l.id = $n [AND l.user_id = $n]` → 404 nếu rỗng.
- **AC**: 4 method public + helper private; `SESSION_FILTER` có mặt trong CẢ 4 method (grep code để tự kiểm trước khi báo xong); KHÔNG `@InjectRepository` nào trong file; param index đúng thứ tự trong MỌI câu SQL ghép.

## T2b — Service test (mock `DataSource.manager.query`) — plan §9
- `listForUser`: 1 phiên hoàn tất (data giả lập trả đúng 1 row từ mock, có cả `check_in_time`/`check_out_time`) → assert KHÔNG có row thứ 2 trùng phiên.
- Case EX1 (`check_in_time` có, `check_out_time` null, `session_status='incomplete'`); case EX2 (ngược lại).
- `listAll`: `departmentId` → dùng `BASE_SELECT_WITH_USER`; không có → dùng `BASE_SELECT` thường (assert đúng biến thể SQL string được gọi).
- `getDetailForUser`/`getDetailAny`: not-found → 404 đúng code; found → map đúng, `image_url` đọc an toàn khi `metadata_json` null.
- Assert `SESSION_FILTER` có trong `WHERE` của cả 4 query (assert bằng cách kiểm tra chuỗi SQL truyền vào `manager.query`).
- Assert JOIN zone luôn kèm `deleted_at IS NULL`.
- Assert thứ tự `params` khớp đúng vị trí `$1,$2,...` trong SQL cuối.
- **AC**: toàn bộ nhánh xanh; đặc biệt PHẢI có test khẳng định KHÔNG trùng dòng cho phiên hoàn tất (đây là bug chính của bản đầu).

## T3 — Controller `GateAccessHistoryController` (code) — plan §6 — KHÔNG đổi so với bản trước
- 4 route giữ nguyên hoàn toàn (route own chỉ `JwtAuthGuard`; route admin thêm `PermissionsGuard`+permission).
- **AC**: 4 route đúng method/path/guard/permission — KHÔNG đổi.

## T3b — Controller test (mock service + mock guard) — plan §9 — KHÔNG đổi so với bản trước
- Mỗi route gọi đúng service method; guard/permission đúng; `userId` route own LUÔN từ `@CurrentUser()`.
- **AC**: assert guard + permission string; envelope response đúng shape.

## T4 — Migration permission (code) — plan §7 — KHÔNG đổi nội dung
- `20260723000002-SeedGateAccessHistoryReadAllPermission.ts`: GIỮ NGUYÊN.
- **AC**: `up()` idempotent; `down()` chỉ xóa permission này.

## T5 — Wiring `gate-access.module.ts` (code) — plan §3 — KHÔNG đổi so với bản trước
- **AC**: `AppModule` compile được (DI-proof).

## T-GATE — (STOP, KHÔNG commit) — plan §10
- build=0; eslint file mới/touched 0 warning mới; `npx jest src/modules/gate-access` xanh (GAP-001 KHÔNG hồi quy); coverage **≥80%** file mới; DI-proof compile `AppModule`. **KHÔNG live, KHÔNG DB thật, KHÔNG commit.**
- In: code đầy đủ 6 file mới + 1 file modified + jest + coverage + báo cáo gate.
- **Owed (ghi, KHÔNG chạy)**: ảnh chụp thật · tổng thời lượng theo ngày · resolve id dòng out đã hấp thụ.
- **AC**: bảng gate đầy đủ + báo cáo: **1 dòng/1 phiên, KHÔNG trùng dòng cho phiên hoàn tất** ✓ · `check_in_time`/`check_out_time` đúng cả 3 case (hoàn tất/EX1/EX2) ✓ · `SESSION_FILTER` có mặt cả 4 method ✓ · JOIN zone luôn `deleted_at IS NULL` ✓ · route own/admin đúng guard ✓ · ownership fold vào WHERE ✓ · READ-ONLY tuyệt đối ✓ · bind param đúng thứ tự (raw SQL) ✓ · GAP-001 không hồi quy ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC-117
- T0 → verify RECON đủ để code (tên cột thật + jsonb parsing)
- T1 → 4 DTO (field check_in_time/check_out_time thay direction/access_time)
- T2/T2b → service raw SQL self-join (BASE_SELECT/SESSION_FILTER/buildWhere + 4 method)
- T3/T3b → controller 4 route (KHÔNG đổi)
- T4 → migration seed permission (KHÔNG đổi)
- T5 → wiring module (KHÔNG đổi)
- T-GATE → gate + STOP + Owed
