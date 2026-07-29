# IOT-GAP-01 — tasks.md (Bổ sung quyền BUSINESS_ADMIN cho `iot.device.read`)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-29 | Tạo tasks: T0 verify timestamp → T1 migration → T2 verify thủ công (không unit test, migration thuần SQL) → T-GATE. | Toàn bộ |

> Map: spec.md, plan.md.

## Thứ tự
T0 → T1 → T2 → T-GATE.

---

## T0 — RECON-verify — plan §0
- `ls src/database/migrations | sort | tail` xác nhận timestamp `<TIMESTAMP>` chưa bị chiếm.
- **AC**: dán xác nhận timestamp thật; nếu đã bị chiếm → đổi số, KHÔNG ghi đè file người khác.

## T1 — Migration (code) — plan §9
- Tạo file mirror chính xác `GrantManagerAvatarReviewPermission.ts`, đổi `role_code='BUSINESS_ADMIN'`, `permission_code='iot.device.read'`.
- **AC**: build TypeScript không lỗi; `down()` xóa đúng dòng đã insert (không xóa nhầm role/permission khác).

## T2 — Verify thủ công sau khi Thiếu Chủ duyệt chạy migration (KHÔNG tự chạy khi chưa duyệt)
- Chạy migration (mirror cách CDB-RS-001 đã làm — `npm run migration:run:tsx`).
- Login BUSINESS_ADMIN, gọi `GET /iot-devices` → xác nhận `200` (trước đó `403`).
- Gọi `PATCH .../disable` (hoặc route thao tác khác) với cùng token → xác nhận VẪN `403` (R2, không bị mở rộng ngoài ý muốn).
- **AC**: đúng R1/R2/R3 spec §4.

## T-GATE — (STOP, KHÔNG chạy migration khi chưa duyệt)
- Migration file build sạch. KHÔNG tự chạy `migration:run`/`migration:run:tsx` lên DB thật cho tới khi Thiếu Chủ xác nhận duyệt spec + plan.
- **AC**: file migration đã sẵn sàng, chờ lệnh chạy.

## Map task → scope IOT-GAP-01
- T0 → verify timestamp
- T1 → code migration
- T2 → verify sau khi chạy (đợt sau, sau duyệt)
- T-GATE → STOP chờ duyệt
