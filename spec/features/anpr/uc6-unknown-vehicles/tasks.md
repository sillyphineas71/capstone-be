# VUN-001 — tasks.md (UC6 ANPR: xem danh sách biển lạ)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-25 | Tạo tasks VUN-001: T0 verify → T1 DTO → T2 VehicleUnknownService → T3 controller route → T4 wiring → T-GATE. Mỗi task 1 AC, code/test tách. C1-isolation, read-only, admin-gate. No-migration. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. No-migration, read-only. KHÔNG dùng `VehicleRegistrationService` · KHÔNG đụng route UC1-3 · KHÔNG seed RBAC (owed). UC1-5 KHÔNG hồi quy.

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T3b → T4 → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận đọc CODE THẬT: face unmapped-review query JSON (raw SQL + bind + LIMIT/OFFSET) để mirror; UC5 payload **top-level** (`payload_json->>'matchState'`, KHÔNG nest); admin-gate UC1 (`PermissionsGuard` + `@RequirePermissions`); pagination UC3 (meta total); `VehicleRegistrationController` + `AnprModule` còn nguyên để thêm route/provider.
- **AC**: dán xác nhận 5 mục; thiếu/path sai → **DỪNG báo Thiếu Chủ** (không bịa).

## T1 — DTO `ListUnknownVehiclesQueryDto` (code) — plan §3, VAL-01, OQ-2
- `src/modules/anpr/dto/list-unknown-vehicles-query.dto.ts`: `page` (`@Type(()=>Number) @IsOptional @IsInt @Min(1)` def 1), `limit` (`@Type Number @IsOptional @IsInt @Min(1) @Max(100)` def 20), `from?`/`to?` (`@IsOptional @IsISO8601`). KHÔNG field khác.
- **AC**: 4 field (page/limit/from/to); page/limit ép Number + biên; from/to `@IsISO8601`.

## T2 — Service `VehicleUnknownService` (code) — plan §2, DATA-01, SEC-03, OQ-1/4
- `src/modules/anpr/services/vehicle-unknown.service.ts`: `@Injectable`, inject `DataSource`. `listUnknown(query)`:
  - WHERE base: `event_type = 'ivss_vehicle_event' AND payload_json->>'matchState' = 'unmatched'`; build động `from`→`AND event_time >= $n`, `to`→`AND event_time <= $n` (push param). **Bind index đúng** khi nối thêm LIMIT/OFFSET (params động trước, limit/offset sau — $ tăng dần liên tục).
  - rows: `SELECT payload_json->>'plateNumber' AS plate_number, (payload_json->>'channelId')::int AS channel_id, payload_json->>'direction' AS direction, event_time, payload_json->>'utc' AS utc, payload_json->>'plateColor' AS plate_color, payload_json->>'vehicleType' AS vehicle_type FROM iot_device_events WHERE <base> ORDER BY event_time DESC LIMIT $ OFFSET $`.
  - total: `SELECT COUNT(*)::int AS total FROM iot_device_events WHERE <base>` (cùng WHERE, KHÔNG limit/offset).
  - `meta = {page, limit, total, totalPages: Math.ceil(total/limit)}`. Map → field cho phép (KHÔNG imageBase64). SEC-03 bind (KHÔNG nối chuỗi). KHÔNG dùng `VehicleRegistrationService`.
- **AC**: SQL C1 (`ivss_vehicle_event`+`matchState='unmatched'`); JSON path top-level `->>`; channelId `::int`; meta total đúng; read-only (chỉ SELECT).

## T2b — Service test (mock DataSource) — DATA-01, OQ-1/2/4, SEC-03
- **list**: mock rows + COUNT → `data` map đúng 7 field (plateNumber/channelId/direction/eventTime/utc/plateColor/vehicleType) + meta (total=25 limit=20→totalPages=2).
- **C1**: SQL chứa `event_type = 'ivss_vehicle_event'` + `payload_json->>'matchState'` `'unmatched'`; KHÔNG `face_verify`/`face_stranger`.
- **JSON path top-level**: SQL chứa `payload_json->>'plateNumber'` (1 mũi tên, KHÔNG `extracted_fields`).
- **time-range 4 tổ hợp**: không-from-không-to / chỉ-from / chỉ-to / cả-hai → SQL có/không `event_time >=`/`<=` + **bind index đúng** (assert params đúng thứ tự, $ không lệch khi có limit/offset).
- **channelId**: SQL chứa `(payload_json->>'channelId')::int`.
- **list rỗng**: COUNT 0 + rows [] → `data:[]`, `meta.total=0`, `totalPages=0`.
- **pagination**: page=2 limit=20 → LIMIT 20 OFFSET 20.
- **SEC-03**: giá trị (from/to/limit/offset) qua bind params, KHÔNG nối chuỗi vào SQL.
- **AC**: nhánh xanh; coverage ≥80% (gộp T-GATE).

## T3 — Controller GET admin route (code) — plan §4, SEC-01, OQ-3/5
- Thêm vào `VehicleRegistrationController`: inject `VehicleUnknownService` (constructor param); `@Get('admin/unknown-vehicles')` `@UseGuards(JwtAuthGuard, PermissionsGuard)` `@RequirePermissions('anpr.vehicle.unknown_view')` `@UsePipes(ValidationPipe{whitelist,transform})` `@Query() query` → `listUnknown(query)` → `{success:true, message:'Unknown vehicles retrieved', data: items, meta}` (200).
- KHÔNG đụng route UC1-3.
- **AC**: route admin có `PermissionsGuard` + `@RequirePermissions('anpr.vehicle.unknown_view')`; trả data+meta; KHÔNG đụng route khác.

## T3b — Controller test (mock service + mock guard) — SEC-01
- route gọi `service.listUnknown(query)`; trả envelope + meta.
- **admin-gate**: assert `__guards__` chứa `PermissionsGuard` + metadata `@RequirePermissions = ['anpr.vehicle.unknown_view']`.
- **AC**: assert gọi service + admin-gate metadata.

## T4 — Module wiring `anpr.module.ts` (code) — plan §5
- providers: thêm `VehicleUnknownService`. controllers giữ nguyên. KHÔNG đổi env/migration.
- **AC**: AppModule compile, 0 circular/UnknownDependencies; controller inject `VehicleUnknownService` OK.

## T-GATE — (STOP, KHÔNG commit) — plan §8
- build=0; eslint touched (service + dto + controller + module + 2 spec) baseline-proof **0 rule mới**, file mới 0; `npx jest src/modules/anpr` xanh (**UC1-5 KHÔNG hồi quy + UC6 mới**); coverage **≥80%** `vehicle-unknown.service.ts`; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies); throwaway xóa. **KHÔNG live, KHÔNG DB, KHÔNG commit.**
- Nếu sửa eslint: **đọc lại file sau khi sửa**, KHÔNG sed/regex hàng loạt làm rỗng assertion.
- In: code đầy đủ file + jest + coverage + báo cáo gate.
- **Owed (ghi, KHÔNG chạy)**: seed permission `anpr.vehicle.unknown_view` (cùng nhóm `anpr.vehicle.admin_register`) — chưa seed → 403 · cảnh báo real-time biển lạ (push/WS) · group-by plateNumber+count · channel filter + channel→tên cổng · UC7 lịch sử đầy đủ · live khi bridge UC8.
- **AC**: bảng gate đầy đủ + báo cáo: C1-isolation (event_type+matchState, KHÔNG face) ✓ · JSON path top-level ->> ✓ · time-range build động bind-index đúng ✓ · channelId ::int ✓ · meta total (COUNT) ✓ · pagination LIMIT/OFFSET ✓ · admin-gate PermissionsGuard+@RequirePermissions ✓ · output 7 field KHÔNG imageBase64 ✓ · list rỗng []+total0 ✓ · validate 400 ✓ · SEC-03 bind + read-only ✓ · KHÔNG VehicleRegistrationService/route-UC1-3/migration ✓ · UC1-5 không hồi quy ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC6
- T0 → verify face-JSON-query/UC5-payload/admin-gate/pagination/controller-module còn nguyên
- T1 → DTO query (page/limit/from/to)
- T2/T2b → `VehicleUnknownService` (raw SQL JSON top-level, C1, time-range bind động, COUNT total)
- T3/T3b → controller GET admin route (PermissionsGuard + unknown_view)
- T4 → wiring provider `VehicleUnknownService`
- T-GATE → gate + STOP + Owed (seed permission · real-time alert · group-by · channel filter · UC7 · live)
