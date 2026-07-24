# GAH-001 — plan.md (UC-117 Gate Access / SAVP: tra cứu lịch sử ra vào cổng)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | **[BUGFIX sau verify thật]** Verify trên RDS chung (cùng đợt seed 20 log của GAP-001) phát hiện lỗi thật: Postgres từ chối `COALESCE(check_in_time, check_out_time)` ở `ORDER BY`/`WHERE` khi `check_in_time`/`check_out_time` là alias `CASE WHEN` trong CÙNG SELECT (`42703 column "check_in_time" does not exist`) — alias chỉ dùng được dạng bare reference, không dùng được lồng trong hàm khác cùng cấp SELECT. Sửa: bọc toàn bộ SELECT self-join vào 1 CTE (`WITH sessions AS (...)`), mọi filter/sort ở tầng ngoài tham chiếu `sessions.<cột>` (cột thật sau khi CTE materialize). Sau khi sửa, verify lại: `listForUser`/`listAll` trả ĐÚNG 1 dòng/1 phiên, không trùng, đủ 3 case (completed/EX1/EX2). | §5 service (SESSIONS_CTE) |
| 2026-07-23 | **[REVISE]** Viết lại service theo raw SQL self-join (1 dòng/1 phiên) thay vì QueryBuilder trên entity (1 dòng/1 log thô). Đổi constructor từ `@InjectRepository` sang `DataSource`. Thêm helper `buildWhere`/pagination raw SQL kiểu `VehicleHistoryService`. Route/permission/migration KHÔNG đổi. | Toàn bộ (rewrite) |
| 2026-07-23 | Tạo plan GAH-001 bản đầu (QueryBuilder, sai shape) — đã thay thế. | (đã thay thế ở dòng trên) |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2. Phụ thuộc module `gate-access` đã tồn tại từ GAP-001.
>
> ⚠️ **Bài học từ verify thật (2026-07-23)**: raw SQL với alias `CASE WHEN` KHÔNG dùng lồng được trong `ORDER BY`/`WHERE` ở CÙNG SELECT — phải bọc CTE. Unit test mock KHÔNG bắt được lỗi cú pháp SQL thật (chỉ assert chuỗi/tham số) — bài test integration trên DB thật (dù chỉ chạy tay 1 lần) vẫn cần thiết cho raw-SQL service.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)
- `gate_access_logs` table tên cột thật (snake_case DB): `id, zone_id, device_id, event_id, user_id, vehicle_registration_id, plate_number, direction, access_time, paired_log_id, duration_seconds, metadata_json, created_at` — raw SQL dùng ĐÚNG tên cột này (KHÔNG dùng tên field TypeScript camelCase).
- `zones` table cột: `id, zone_code, zone_name, ..., deleted_at`.
- `users` table cột: `id, ..., department_id` — JOIN CHỈ khi filter `department_id`.
- `metadata_json` là `jsonb` — đọc `metadata_json->>'imageUrl'` ở tầng SQL HOẶC đọc `row.metadata_json?.imageUrl` ở tầng JS sau khi driver parse JSONB thành object (TypeORM raw query driver `pg` tự parse jsonb thành JS object) — chọn đọc ở tầng JS (mapper) để giữ SELECT gọn, mirror cách entity vốn cũng expose `metadataJson` là object.
- Migration mới nhất tại thời điểm viết plan: `20260723000001` (GAP-001). GAH-001 GIỮ NGUYÊN timestamp `20260723000002` cho migration permission (chưa từng chạy, nội dung không đổi).
- `AuthModule` cần import vào `gate-access.module.ts` — GIỮ NGUYÊN quyết định từ bản trước.

## 1. Quyết định đã chốt (từ spec §1/§2)
Xem spec §1 (ảnh = metadata_json) + §2 (1 dòng/1 phiên, công thức lọc `direction='in' OR paired_log_id IS NULL`, check_in/check_out derive theo self-join, sort theo COALESCE, giới hạn detail id). Constitution đầy đủ ở spec §8. Plan KHÔNG mở lại.

## 2. Entity — KHÔNG đổi, KHÔNG dùng Repository cho query chính
`GateAccessLogEntity` giữ nguyên 100%. Service dùng `DataSource.manager.query()` raw SQL cho 4 method chính (self-join CASE phức tạp hơn khả năng diễn đạt gọn của QueryBuilder khi JOIN điều kiện phụ thuộc giá trị cột `direction`).

## 3. Module `gate-access` (modified — bổ sung so với GAP-001) — KHÔNG đổi so với bản trước
```
src/modules/gate-access/gate-access.module.ts
```
- Thêm `AuthModule` vào `imports`.
- Thêm `GateAccessHistoryService` vào `providers`.
- Thêm `GateAccessHistoryController` vào `controllers`.

## 4. DTO (4 file mới — đổi field summary so với bản trước)
- `dto/list-gate-access-history-query.dto.ts`: `page`/`limit`, `from?`/`to?` (ISO8601), `zone_id?` (UUID) — KHÔNG đổi.
- `dto/list-gate-access-history-admin-query.dto.ts extends ...`: thêm `user_id?`, `department_id?` — KHÔNG đổi.
- `dto/gate-access-history-item-response.dto.ts`: class `GateAccessHistoryItemDto` (đổi field: `check_in_time`, `check_out_time` thay cho `direction`/`access_time` cũ) + hàm `toGateAccessHistoryItemDto(row, includeUserId)`.
- `dto/gate-access-history-detail-response.dto.ts`: `GateAccessHistoryDetailDto extends GateAccessHistoryItemDto` (thêm `image_url`) + `toGateAccessHistoryDetailDto(row, includeUserId)`.

## 5. Service — `GateAccessHistoryService` (file mới, raw SQL self-join)
```
src/modules/gate-access/services/gate-access-history.service.ts
```
- Constructor: `constructor(private readonly dataSource: DataSource) {}`.
- **Câu SELECT nền tảng** (const string dùng chung, nội suy phần JOIN `users` có điều kiện qua flag, KHÔNG nội suy giá trị filter):
```ts
const BASE_SELECT = `
  SELECT
    l.id, l.zone_id, z.zone_code, z.zone_name, l.user_id, l.plate_number, l.metadata_json,
    CASE WHEN l.direction = 'in' THEN l.access_time ELSE NULL END AS check_in_time,
    CASE
      WHEN l.direction = 'out' THEN l.access_time
      WHEN l.direction = 'in' AND paired.id IS NOT NULL THEN paired.access_time
      ELSE NULL
    END AS check_out_time,
    l.duration_seconds,
    CASE WHEN l.paired_log_id IS NOT NULL THEN 'completed' ELSE 'incomplete' END AS session_status
  FROM gate_access_logs l
  LEFT JOIN zones z ON z.id = l.zone_id AND z.deleted_at IS NULL
  LEFT JOIN gate_access_logs paired ON paired.id = l.paired_log_id
`;
const SESSION_FILTER = `(l.direction = 'in' OR l.paired_log_id IS NULL)`;
```
- `private buildWhere(query, extraConditions: string[] = []): {where: string; params: unknown[]}`:
  - `params = []`, `conditions = [SESSION_FILTER, ...extraConditions]`.
  - `if (query.from) { params.push(query.from); conditions.push(\`l.access_time >= $${params.length}\`); }` — tương tự `to`, `zoneId`.
  - Trả `{where: conditions.join(' AND '), params}`.
- `listForUser(userId, query)`:
  1. `params.push(userId)` TRƯỚC khi gọi `buildWhere` (giữ index `$1` cố định cho `userId` — HOẶC đơn giản hơn: build `extraConditions=['l.user_id = $N']` sau khi biết tổng param, xem cách làm chi tiết ở T2 để tránh lệch index).
  2. `SELECT COUNT(*) FROM gate_access_logs l WHERE ${where}` (KHÔNG cần JOIN cho COUNT nếu điều kiện không phụ thuộc JOIN — ở đây điều kiện CHỈ dùng cột của `l`, JOIN `zones`/`paired` KHÔNG cần thiết cho COUNT, bỏ JOIN ở câu COUNT để nhanh hơn).
  3. `${BASE_SELECT} WHERE ${where} ORDER BY COALESCE(check_in_time, check_out_time) DESC LIMIT $n OFFSET $n`.
  4. Map rows → `toGateAccessHistoryItemDto(row, false)`.
- `listAll(query)`: tương tự nhưng KHÔNG khóa `userId`; nếu có `query.userId` → thêm điều kiện `l.user_id = $n`; nếu có `query.departmentId` → `BASE_SELECT` cần thêm `LEFT JOIN users u ON u.id = l.user_id` (biến thể `BASE_SELECT_WITH_USER`) + điều kiện `u.department_id = $n`. Map → `toGateAccessHistoryItemDto(row, true)`.
- `getDetailForUser(id, userId)`: `${BASE_SELECT} WHERE ${SESSION_FILTER} AND l.id = $1 AND l.user_id = $2` → rỗng → `NotFoundException({code:'GATE_ACCESS_LOG_NOT_FOUND', ...})` → `toGateAccessHistoryDetailDto(row, false)`.
- `getDetailAny(id)`: `${BASE_SELECT} WHERE ${SESSION_FILTER} AND l.id = $1` → rỗng → 404 → `toGateAccessHistoryDetailDto(row, true)`.
- ⚠️ **Lưu ý bind-param index khi ghép `BASE_SELECT` + `WHERE` + `LIMIT/OFFSET`**: `params` PHẢI theo ĐÚNG thứ tự xuất hiện `$1, $2, ...` trong câu SQL cuối cùng — viết `buildWhere` trả `params` theo đúng thứ tự push, `LIMIT`/`OFFSET` PHẢI push SAU CÙNG (mirror `VehicleHistoryService.paginate`: `[...params, limit, offset]`).

## 6. Controller — `GateAccessHistoryController` (file mới) — KHÔNG đổi so với bản trước
```
src/modules/gate-access/controllers/gate-access-history.controller.ts
```
- `@Controller('gate-access')`. 4 route giữ nguyên (2 own chỉ `JwtAuthGuard`, 2 admin thêm `PermissionsGuard`+`@RequirePermissions('gate_access.history.read_all')`).

## 7. Migration permission — KHÔNG đổi
```
src/database/migrations/20260723000002-SeedGateAccessHistoryReadAllPermission.ts
```
Nội dung GIỮ NGUYÊN (permission `gate_access.history.read_all`, roles `SYSTEM_ADMIN/BUSINESS_ADMIN/MANAGER`).

## 8. File list
### Net-new (7 file) — KHÔNG đổi số lượng so với bản trước
- `src/modules/gate-access/dto/list-gate-access-history-query.dto.ts`
- `src/modules/gate-access/dto/list-gate-access-history-admin-query.dto.ts`
- `src/modules/gate-access/dto/gate-access-history-item-response.dto.ts`
- `src/modules/gate-access/dto/gate-access-history-detail-response.dto.ts`
- `src/modules/gate-access/services/gate-access-history.service.ts` (+ `.spec.ts`)
- `src/modules/gate-access/controllers/gate-access-history.controller.ts` (+ `.spec.ts`)
- `src/database/migrations/20260723000002-SeedGateAccessHistoryReadAllPermission.ts`
### Modified (1 file)
- `src/modules/gate-access/gate-access.module.ts`: KHÔNG đổi so với bản trước.
> Tổng **7 net-new + 1 modified**. 0 thay đổi entity/schema. 1 migration (permission-only, KHÔNG đổi nội dung).

## 9. Test (mock `DataSource.manager.query` — KHÔNG DB)
- `listForUser`: chỉ trả phiên của đúng `userId`; 1 phiên hoàn tất (2 dòng log gốc: `in`+`out` đã ghép) → CHỈ 1 item trong kết quả (assert KHÔNG bị trùng 2 dòng) với CẢ `check_in_time` LẪN `check_out_time` có giá trị.
- Case EX1 (chỉ `in`, chưa ghép): 1 item, `check_in_time` có giá trị, `check_out_time: null`, `session_status: 'incomplete'`.
- Case EX2 (chỉ `out`, chưa ghép): 1 item, `check_in_time: null`, `check_out_time` có giá trị, `session_status: 'incomplete'`.
- `listAll`: `departmentId` → JOIN `users` được dùng (biến thể `BASE_SELECT_WITH_USER`); không có → KHÔNG JOIN `users`.
- `getDetailForUser`: phiên của người khác/id là dòng `out` đã hấp thụ (không xuất hiện độc lập, `SESSION_FILTER` loại) → 404; phiên của mình → có `image_url`.
- `getDetailAny`: bất kỳ phiên nào (đúng `SESSION_FILTER`) → trả được.
- Assert `SESSION_FILTER` (`direction='in' OR paired_log_id IS NULL`) có mặt trong CẢ 4 method.
- Assert JOIN zone có `z.deleted_at IS NULL` trong MỌI method.
- Assert thứ tự bind-param `$1,$2,...` khớp đúng vị trí trong câu SQL cuối (test bằng cách assert `manager.query` được gọi với `params` đúng thứ tự, KHÔNG chỉ đúng nội dung).
- Controller: guard đúng cho 4 route; route own `userId` LUÔN từ `@CurrentUser()`.
- Coverage **≥80%** file mới.

## 10. Gate (STOP, KHÔNG commit)
- build=0; eslint file mới 0 warning mới; `npx jest src/modules/gate-access` xanh (GAP-001 KHÔNG hồi quy); coverage ≥80% file mới; DI-proof compile `AppModule`. **KHÔNG live, KHÔNG DB thật.**
- **Owed (ghi, KHÔNG chạy)**: ảnh chụp thật qua `iot_device_events`/`media_files` · tổng thời lượng theo ngày (Bước 5) · resolve id dòng `out` đã hấp thụ.

## 11. Kỷ luật
- **DATA-01**: READ-ONLY tuyệt đối.
- **DATA-02 (crux)**: JOIN zone LUÔN kèm `z.deleted_at IS NULL`.
- **DATA-03 (crux, MỚI)**: `SESSION_FILTER` PHẢI có mặt trong CẢ 4 method — đây là điểm sửa chính của bản revise, KHÔNG được thiếu ở BẤT KỲ method nào.
- **SEC-03**: raw SQL — bind tham số TUYỆT ĐỐI, KHÔNG nội suy chuỗi filter vào câu SQL (kể cả `department_id`/`user_id` dù là UUID đã validate).
- KHÔNG tự làm UC-114/UC-116 ở đây.

> **STOP.** Plan-only (viết lại cùng lượt với spec sau khi phát hiện sai shape). Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md. KHÔNG tự code.
