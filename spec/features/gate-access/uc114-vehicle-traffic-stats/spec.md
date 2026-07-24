# VTS-001 — UC-114 (Gate Access / SAVP): Thống kê lưu lượng phương tiện

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | **[REVISE]** Đổi nguồn dữ liệu từ `gate_access_logs` sang `iot_device_events` (`event_type='ivss_vehicle_event'`) — đúng PRE-2 SRS trích dẫn "UC-ANPR-05" (sự kiện biển số thô). Thiếu Chủ xác nhận trực tiếp sau khi tôi tự phát hiện lệch lúc rà soát lại spec với SRS. Viết lại toàn bộ §0, §3, §4, §5, §7, §9. Đổi từ vựng `direction` sang đúng domain gốc (`enter/leave/seen`, KHÔNG phải `in/out` của `gate_access_logs`). | Toàn bộ (rewrite) |
| 2026-07-23 | Tạo spec VTS-001 (UC-114) bản đầu — dùng `gate_access_logs`, sau phát hiện sai nguồn dữ liệu khi đối chiếu SRS. | (đã thay thế ở dòng trên) |

> Cùng nhóm Bước 2 với [../uc116-pair-gate-sessions/spec.md](../uc116-pair-gate-sessions/spec.md) (UC-116) và [../uc117-gate-access-history/spec.md](../uc117-gate-access-history/spec.md) (UC-117). **Feature này KHÔNG còn phụ thuộc `gate_access_logs`/UC-116 nữa** — đọc thẳng `iot_device_events`, độc lập hoàn toàn với 2 feature kia (chỉ chung module `gate-access` vì roadmap gộp chung 1 đợt giao).
>
> **STOP.** Chờ Thiếu Chủ duyệt spec+plan+tasks trước khi cho phép code.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. SRS PRE-2 — nguồn dữ liệu chính xác
> "PRE-2. Đã tồn tại dữ liệu **sự kiện biển số (UC-ANPR-05)** trong khoảng thời gian cần thống kê."

UC-ANPR-05 (đánh số nội bộ, khớp code comment `VRE-001 / UC5`) = **`VehicleResolveService`** — nơi GHI sự kiện nhận diện biển số vào `iot_device_events`. Đây là bảng nguồn ĐÚNG theo SRS, KHÔNG phải `gate_access_logs` (bảng đó thuộc phạm vi UC-115/116, ghi bởi phía Hải, chỉ có ở zone loại "cổng" đã convert xong).

### 0.2. Payload thật đã ghi ([vehicle-resolve.service.ts:73-94](../../../../src/modules/anpr/services/vehicle-resolve.service.ts))
```
INSERT INTO iot_device_events
  (device_id, room_id, meeting_id, event_type, event_time, source_protocol, severity, payload_json, processed_status)
VALUES ($1, NULL, NULL, 'ivss_vehicle_event', $2, 'ivss', 'info', $3::jsonb, $4)
```
`payload_json` gồm: `plateRaw`, `plateNumber`, `userId` (nullable), `channelId`, **`direction`** (giá trị THẬT: `'enter' | 'leave' | 'seen'` — xem `normalizeVehicleDirection()`, **KHÔNG PHẢI `'in'|'out'`** như `gate_access_logs`), `matchState` (`'matched'|'unmatched'`), `eventActionRaw`, `plateColor`, `vehicleColor`, **`vehicleType`** (có sẵn trong payload — KHÔNG cần JOIN `vehicle_registrations` để lọc loại xe, khác bản spec cũ), `utc`, `receivedAt`.

### 0.3. ⚠️ Phát hiện quan trọng — `zone_id` KHÔNG được ghi cho vehicle event
`iot_device_events.zone_id` (cột đã có sẵn, migration `20260721000003`) **KHÔNG nằm trong danh sách cột INSERT** ở `VehicleResolveService.onVehicleEvent()` (xem câu SQL ở §0.2 — chỉ có `device_id, room_id, meeting_id, event_type, event_time, source_protocol, severity, payload_json, processed_status`, KHÔNG có `zone_id`). Nghĩa là **mọi vehicle event hiện tại có `zone_id = NULL`**.

Thêm nữa: `device_id` của MỌI vehicle event là **CÙNG MỘT thiết bị cầu nối cố định** (`IVSS-BRIDGE`, xem `resolveBridgeDeviceId()`) — KHÔNG phải camera riêng theo từng cổng/khu vực, nên dù có join `iot_devices.zone_id` cũng không tách được zone theo channel.

**Hệ quả cho UC-114**: filter "theo cổng (zone)" mà SRS yêu cầu **hiện tại không thể trả kết quả có ý nghĩa** — mọi event đều `zone_id = NULL`. Đây là hạn chế ở PHÍA GHI DỮ LIỆU (thuộc `VehicleResolveService`/module `anpr`, phần việc của Hải theo phân công CLAUDE.md §5.5 quy tắc 6 — Hải ghi event), KHÔNG phải lỗi của UC-114. Quyết định: **vẫn viết filter `zone_id` đúng theo schema** (tương lai đúng khi Hải cập nhật ghi `zone_id`), nhưng ghi rõ residual — KHÔNG tự sửa `VehicleResolveService`.

### 0.4. Pattern raw-SQL thật — `VehicleHistoryService` ([vehicle-history.service.ts](../../../../src/modules/anpr/services/vehicle-history.service.ts))
Đây là service ĐANG đọc CHÍNH bảng/CHÍNH `event_type` mà UC-114 cần — inject `DataSource`, `dataSource.manager.query()` raw SQL, bind param nối tiếp (`params.push(...)`, `$${params.length}`), tách COUNT riêng khỏi query rows. UC-114 PHẢI mirror đúng pattern này (KHÔNG dùng QueryBuilder/Repository qua entity — `IoTDeviceEventType` enum trong entity KHÔNG có giá trị `'ivss_vehicle_event'`, xác nhận raw SQL là cách đúng, đúng tiền lệ).

### 0.5. `ListVehicleHistoryQueryDto` ([list-vehicle-history-query.dto.ts](../../../../src/modules/anpr/dto/list-vehicle-history-query.dto.ts))
Xác nhận vocabulary filter `direction` hợp lệ: `@IsIn(['enter', 'leave', 'seen'])` — UC-114 dùng ĐÚNG 3 giá trị này cho breakdown, KHÔNG bịa `in`/`out`.

---

## 1. Câu hỏi nghiệp vụ đã chốt

1. (Từ vòng hỏi Bước 2 ban đầu) Phạm vi "chỉ tính phương tiện" — **tự động thỏa mãn** khi đổi nguồn sang `event_type='ivss_vehicle_event'`: toàn bộ dòng của event_type này ĐỀU LÀ sự kiện nhận diện biển số theo đúng bản chất bảng, không còn khái niệm "log không có biển số" lẫn vào (khác `gate_access_logs` vốn dùng chung cho cả người đi bộ). Không cần filter `plate_number IS NOT NULL` như bản cũ (dù vẫn giữ defensive check — xem §5).
2. (Chốt lại 2026-07-23, sau khi Thiếu Chủ xác nhận) **Nguồn dữ liệu = `iot_device_events`** (KHÔNG dùng `gate_access_logs`) — đúng câu chữ SRS PRE-2.

## 2. Quyết định thiết kế suy luận thêm

1. **`zone_id` filter giữ nguyên trong DTO nhưng ghi rõ hiện KHÔNG có tác dụng thật** (§0.3) — thiết kế đúng schema, chờ Hải cập nhật ghi `zone_id` ở `VehicleResolveService`. KHÔNG tự sửa file đó (ngoài phạm vi Tài).
2. **Không group theo zone trong output** — giữ nguyên quyết định cũ, filter đơn zone (nếu có tác dụng trong tương lai).
3. **Vocabulary `direction` = `enter/leave/seen`** (đổi từ `in/out` ở bản cũ, vốn mượn nhầm từ `gate_access_logs`) — summary + series breakdown theo đúng 3 giá trị thật.
4. **`vehicleType` lấy trực tiếp từ `payload_json->>'vehicleType'`**, KHÔNG JOIN `vehicle_registrations` (khác bản cũ) — dữ liệu đã có sẵn trong payload lúc ghi event, kể cả log biển lạ (`matchState='unmatched'`) vẫn có `vehicleType` nếu IVSS trả về được.
5. **`group_by` (`'day'|'hour'`, default `'day'`)** — giữ nguyên quyết định kỹ thuật cũ (không phải luật nghiệp vụ).
6. **`from`/`to` bắt buộc** — giữ nguyên.
7. **Bucket theo `event_time`** (cột thật của `iot_device_events`, KHÔNG phải field trong payload) — dùng `to_char(event_time, ...)` giống UC7.

---

## 3. Scope (UC-114)

### TRONG scope
1. **GET** `/api/v1/gate-access/admin/vehicle-traffic-stats` — Admin/Manager, `PermissionsGuard + @RequirePermissions('gate_access.stats.read')` (route/permission GIỮ NGUYÊN dù đổi nguồn dữ liệu — không phá contract đã duyệt).
2. Nguồn: `iot_device_events WHERE event_type = 'ivss_vehicle_event'`.
3. Filter: `from`/`to` (bắt buộc, ISO8601, so trên cột `event_time`), `zone_id?` (UUID, so trên cột `zone_id` — hiện luôn NULL, xem §0.3), `vehicle_type?` (string, so `payload_json->>'vehicleType'`), `group_by?` (`'day'|'hour'`, default `'day'`).
4. Output: `summary` (`total_events`, `total_matched`, `total_unmatched`, `total_enter`, `total_leave`, `total_seen`, `unique_vehicles`) + `series` (mảng `{bucket, enter, leave, seen}`).
5. Migration seed permission `gate_access.stats.read` — GIỮ NGUYÊN từ bản trước (roles `SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER`).
6. Wiring vào module `gate-access` (đã tạo ở GAP-001/GAH-001) — service mới inject `DataSource`, KHÔNG cần `TypeOrmModule.forFeature` entity mới (raw SQL, mirror `VehicleHistoryService`).

### NGOÀI scope (UC sau — KHÔNG làm ở đây)
- Sửa `VehicleResolveService` để ghi `zone_id` thật cho vehicle event — thuộc phía Hải/module `anpr` ghi event, ngoài phân công của Tài (CLAUDE.md §5.5 quy tắc 6).
- Xuất báo cáo PDF/Excel (UC-128 — Bước 5, tái dùng service này làm nguồn số liệu).
- Ghép cặp gate (UC-116) / tra cứu lịch sử (UC-117) — 2 feature riêng, KHÔNG còn liên quan bảng nguồn với feature này nữa.
- Cache/pre-aggregate.
- So sánh nhiều zone cùng lúc.

---

## 4. DTO (đề xuất — mô tả, KHÔNG code)
- **`VehicleTrafficStatsQueryDto`**: `from` (`@IsISO8601 @IsNotEmpty`), `to` (`@IsISO8601 @IsNotEmpty`), `zone_id?` (`@IsOptional @IsUUID`), `vehicle_type?` (`@IsOptional @IsString @MaxLength(50)`), `group_by?` (`@IsOptional @IsIn(['day','hour'])`).
- **`VehicleTrafficStatsSummaryDto`**: `total_events`, `total_matched`, `total_unmatched`, `total_enter`, `total_leave`, `total_seen`, `unique_vehicles` (tất cả `number`).
- **`VehicleTrafficStatsBucketDto`**: `bucket` (string), `enter` (`number`), `leave` (`number`), `seen` (`number`).
- **`VehicleTrafficStatsResponseDto`**: `{ summary: VehicleTrafficStatsSummaryDto; series: VehicleTrafficStatsBucketDto[] }`.

## 5. Service (đề xuất — `VehicleTrafficStatsService` mới, module `gate-access`, mirror `VehicleHistoryService`)
- Constructor: `private readonly dataSource: DataSource` (KHÔNG `@InjectRepository` — raw SQL trên bảng thuộc module `iot`, đúng tiền lệ `VehicleHistoryService`).
- `getStats(query)`:
  1. Validate `from <= to` → 400 `INVALID_DATE_RANGE` nếu sai (trước khi query DB).
  2. Build `WHERE` động: LUÔN có `event_type = 'ivss_vehicle_event' AND event_time BETWEEN $1 AND $2`; `AND zone_id = $n` nếu có `zoneId`; `AND payload_json->>'vehicleType' = $n` nếu có `vehicleType`.
  3. **Summary**: 1 raw query `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE payload_json->>'matchState'='matched') AS matched, COUNT(*) FILTER (WHERE payload_json->>'matchState'='unmatched') AS unmatched, COUNT(*) FILTER (WHERE payload_json->>'direction'='enter') AS enter_count, COUNT(*) FILTER (WHERE payload_json->>'direction'='leave') AS leave_count, COUNT(*) FILTER (WHERE payload_json->>'direction'='seen') AS seen_count, COUNT(DISTINCT payload_json->>'plateNumber') AS unique_vehicles FROM iot_device_events WHERE ${where}` với params.
  4. **Series**: `SELECT ${bucketExpr} AS bucket, payload_json->>'direction' AS direction, COUNT(*) AS cnt FROM iot_device_events WHERE ${where} GROUP BY bucket, direction ORDER BY bucket ASC`, `bucketExpr` = `to_char(event_time, 'YYYY-MM-DD')` (day) hoặc `to_char(event_time, 'YYYY-MM-DD HH24:00')` (hour) — CHỈ 2 giá trị cố định từ `@IsIn`, KHÔNG nội suy input người dùng vào biểu thức SQL (SEC-03).
  5. `pivotSeries(rawRows)`: gom theo `bucket` → `{bucket, enter, leave, seen}`, thiếu hướng nào = `0`.
  6. Không có dữ liệu khớp filter → `summary` toàn `0`, `series: []`, KHÔNG lỗi.
- Helper `private buildWhere(query): {where: string; params: unknown[]}` dùng chung cho summary + series (mirror `applyFilters` của `VehicleHistoryService`).

## 6. Controller (đề xuất — `VehicleTrafficStatsController` mới, module `gate-access`)
- `@Controller('gate-access/admin')`.
- `@Get('vehicle-traffic-stats')` `@UseGuards(JwtAuthGuard, PermissionsGuard)` `@RequirePermissions('gate_access.stats.read')` `@UsePipes(ValidationPipe({whitelist:true, transform:true}))` → `getStats(@Query() query)` → `{success:true, message:'Vehicle traffic statistics retrieved', data: {summary, series}}` (KHÔNG `meta`).

## 7. Requirements (EARS)
- **R1**: **WHEN** Admin/Manager gửi `GET /gate-access/admin/vehicle-traffic-stats` với `from`/`to` hợp lệ **→** hệ thống trả `summary` + `series` tính TRÊN `iot_device_events WHERE event_type='ivss_vehicle_event'` trong khoảng `[from, to]` (đúng nguồn PRE-2 SRS).
- **R2**: **WHERE** filter `vehicle_type` được cung cấp **→** hệ thống so khớp `payload_json->>'vehicleType'`, KHÔNG JOIN bảng khác.
- **R3**: **WHERE** filter `zone_id` được cung cấp **→** hệ thống so khớp cột `zone_id` của `iot_device_events` (ghi chú: hiện tại luôn trả rỗng vì dữ liệu ghi chưa set cột này — residual §0.3/§9, KHÔNG phải lỗi logic UC-114).
- **R4**: **WHERE** `group_by='hour'` **→** bucket theo giờ; **WHERE** absent/`'day'` **→** bucket theo ngày.
- **R5**: **THE system SHALL** breakdown `series`/`summary` theo ĐÚNG 3 giá trị `direction` thật (`enter`/`leave`/`seen`), KHÔNG dùng `in`/`out`.
- **R6**: **IF** không có sự kiện nào khớp filter **→** `summary` toàn `0`, `series: []`, KHÔNG lỗi.
- **R7**: **IF** `from` > `to` hoặc thiếu 1 trong 2 **→** `400`, từ chối trước khi query DB.
- **R8**: **IF** user không có quyền `gate_access.stats.read` **→** `403`.

## 8. Constitution
- **SEC-01**: Route admin-gated (`PermissionsGuard + @RequirePermissions`), KHÔNG route self-service.
- **ARCH-01**: File mới hoàn toàn trong module `gate-access`, nhưng đọc bảng thuộc module `iot` qua `DataSource` raw SQL — mirror tiền lệ `VehicleHistoryService` (chấp nhận cross-module raw-SQL read qua `DataSource`, KHÔNG qua entity/repository của module khác — khác nguyên tắc "qua service" áp dụng cho `zones→iot`).
- **DATA-01**: READ-ONLY tuyệt đối trên `iot_device_events`.
- **DATA-02**: `event_type = 'ivss_vehicle_event'` LUÔN là điều kiện WHERE đầu tiên, KHÔNG được thiếu (tránh lẫn face event/heartbeat/... event khác cùng bảng).
- **SEC-03**: bind tham số cho MỌI filter động; `bucketExpr` CHỈ 2 nhánh cố định từ `@IsIn`.
- **PERM-01**: permission `gate_access.stats.read` GIỮ NGUYÊN (không đổi so với bản trước dù đổi nguồn dữ liệu).
- **NO-SCOPE-01**: KHÔNG tự sửa `VehicleResolveService` (ghi `zone_id`) — ngoài phân công Tài.

## 9. Residuals / known-gaps
- ⚠️ **`zone_id` filter hiện KHÔNG có tác dụng thật** — mọi vehicle event có `zone_id=NULL` do `VehicleResolveService` chưa ghi cột này (§0.3). Cần báo Hải cập nhật INSERT nếu muốn filter theo cổng hoạt động thật. UC-114 vẫn implement filter đúng schema, sẵn sàng hoạt động ngay khi dữ liệu được ghi đủ.
- **Cache/pre-aggregate** — chưa cần ở Bước 2.
- **UC-128 renderer** (Bước 5) tái dùng `getStats()`.
- **`channelId → zone` mapping** — nếu cần filter theo cổng TRƯỚC KHI Hải sửa ghi `zone_id`, có thể cân nhắc map `payload_json->>'channelId'` sang zone qua bảng cấu hình riêng — KHÔNG làm ở Bước 2, chỉ ghi nhận hướng giải quyết thay thế.

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md của cả 3 UC Bước 2 trước khi cho phép code. KHÔNG tự code khi chưa có xác nhận.
