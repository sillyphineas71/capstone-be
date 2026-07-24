# GAH-001 — UC-117 (Gate Access / SAVP): Xem & tra cứu lịch sử ra vào cổng

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | **[REVISE]** Sửa shape output từ "1 dòng = 1 log thô (in HOẶC out)" sang "1 dòng = 1 phiên" (đúng POST-1 SRS: mỗi bản ghi gồm cả `thời gian vào` VÀ `thời gian ra` trong CÙNG 1 record). Tự phát hiện lệch khi rà soát lại spec với SRS, Thiếu Chủ xác nhận sửa. Viết lại §0, §2, §4, §5, §6, §7. Đổi cách truy vấn từ QueryBuilder sang raw SQL (self-join cần thiết để gộp cặp in/out). | Toàn bộ (rewrite) |
| 2026-07-23 | Tạo spec GAH-001 bản đầu — shape sai (flat log row), đã thay thế. | (đã thay thế ở dòng trên) |

> Cùng nhóm Bước 2 với [../uc116-pair-gate-sessions/spec.md](../uc116-pair-gate-sessions/spec.md) (UC-116, ghi `paired_log_id`/`duration_seconds`). UC-117 vẫn phụ thuộc dữ liệu UC-116 ghi ra — chỉ đổi cách TRÌNH BÀY kết quả, không đổi phụ thuộc.
>
> **STOP.** Chờ Thiếu Chủ duyệt spec+plan+tasks trước khi cho phép code.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. SRS POST-1 — shape bản ghi ĐÚNG
> "POST-1. Danh sách lịch sử ra/vào phù hợp với phạm vi quyền của người dùng được hiển thị, gồm: **thời gian vào, thời gian ra, tổng thời lượng, cổng, trạng thái phiên (Hoàn tất/Chưa hoàn tất)**."

Đây là 1 RECORD/1 PHIÊN, có 2 field thời gian riêng biệt trong CÙNG 1 dòng — KHÔNG PHẢI 1 dòng cho mỗi lượt quẹt (vào và ra tách 2 dòng). Bản spec trước (đã thay thế) thiết kế sai: trả `direction` + `access_time` (1 giá trị duy nhất) cho mỗi dòng, khiến 1 phiên hoàn tất hiện ra 2 dòng riêng biệt (1 dòng `in`, 1 dòng `out`) thay vì 1 dòng gộp.

### 0.2. Cấu trúc ghép cặp từ GAP-001 (UC-116) — nền tảng cho self-join
`GateAccessLogEntity`: mỗi phiên hoàn tất có 2 dòng RIÊNG BIỆT trong `gate_access_logs` (1 dòng `direction='in'`, 1 dòng `direction='out'`), LIÊN KẾT qua `paired_log_id` (self-FK, ĐỐI XỨNG — GAP-001 ghi `paired_log_id` chéo nhau + `duration_seconds` giống nhau trên CẢ HAI dòng). Để trình bày ĐÚNG 1 dòng/1 phiên, PHẢI:
- Lấy dòng `direction='in'` làm ĐẠI DIỆN phiên (dù đã ghép hay chưa — case "Chưa hoàn tất" EX1).
- Self-JOIN sang dòng `out` tương ứng qua `paired_log_id` để lấy `thời gian ra`.
- **CỘNG THÊM** các dòng `direction='out'` CHƯA GHÉP (`paired_log_id IS NULL`, case EX2 "Không xác định thời điểm vào") — các dòng này KHÔNG có `in` tương ứng nên KHÔNG bị dòng `in` nào đại diện, phải tự làm đại diện phiên (thiếu `thời gian vào`).
- LOẠI BỎ dòng `out` ĐÃ GHÉP (`paired_log_id IS NOT NULL`) khỏi tập kết quả riêng — đã được biểu diễn qua dòng `in` tương ứng (tránh trùng 2 dòng cho 1 phiên).

Công thức lọc 1 dòng/1 phiên: **`WHERE direction = 'in' OR paired_log_id IS NULL`** (giữ toàn bộ `in`, giữ `out` chỉ khi chưa ghép — loại đúng `out` đã ghép).

### 0.3. Pattern raw-SQL self-join — chưa có tiền lệ y hệt trong repo, mirror tinh thần `VehicleHistoryService` (bind param nối tiếp, tách COUNT riêng) nhưng thêm 1 LEFT JOIN vào CHÍNH bảng nguồn (self-join) — cần vì logic CASE + JOIN có điều kiện phụ thuộc `direction` khó diễn đạt gọn bằng QueryBuilder TypeORM (`.leftJoin` với điều kiện ON động theo giá trị cột khác không phải quan hệ khai báo sẵn).

### 0.4. Các RECON còn lại — GIỮ NGUYÊN từ bản trước
- `GateAccessLogEntity.zone`/`.user` relation object có sẵn — VẪN join được `zones`/`users` (dùng tên bảng thật trong raw SQL: `zones z ON z.id = l.zone_id AND z.deleted_at IS NULL`, `users u ON u.id = l.user_id`).
- `zones.deleted_at` trap — CLAUDE.md §5.5 quy tắc 1 — VẪN áp dụng, JOIN kèm `z.deleted_at IS NULL`.
- `UserEntity.departmentId` — VẪN dùng để lọc phòng ban (route admin).
- Pattern "own route vs admin route" (UC7 `vehicle-history`) — GIỮ NGUYÊN.

---

## 1. Câu hỏi nghiệp vụ đã chốt (áp dụng chung Bước 2 — xem GAP-001 §1)

Liên quan trực tiếp UC-117: **nguồn ảnh chụp** — CHỈ trả field optional từ `metadata_json.imageUrl` (đọc trên dòng đại diện phiên — dòng `in` nếu có, dòng `out` nếu là case EX2) nếu có, KHÔNG JOIN sang `iot_device_events`/`media_files`.

## 2. Quyết định thiết kế (đã sửa sau rà soát SRS)

1. **1 dòng = 1 phiên**, KHÔNG phải 1 dòng = 1 log thô. `id` trả về = id của dòng ĐẠI DIỆN (dòng `in` khi có, hoặc dòng `out` đứng riêng khi EX2) — client dùng `id` này để gọi detail; KHÔNG dùng id của dòng `out` ĐÃ GHÉP (dòng đó không xuất hiện độc lập trong list, xem §0.2).
2. **`check_in_time`**: giá trị `access_time` của dòng `in` nếu dòng đại diện là `in`; `null` nếu dòng đại diện là `out` đứng riêng (EX2).
3. **`check_out_time`**: giá trị `access_time` của dòng `out` liên kết (qua self-join `paired_log_id`) nếu đại diện là `in` VÀ đã ghép; giá trị `access_time` của chính dòng đó nếu đại diện là `out` đứng riêng (EX2); `null` nếu đại diện là `in` CHƯA ghép (EX1).
4. **`session_status`**: `'completed'` khi `paired_log_id IS NOT NULL` (bất kể đại diện là dòng nào); `'incomplete'` khi `NULL` — giữ đúng 2 giá trị literal SRS (không bịa trạng thái thứ 3 phân biệt EX1/EX2 ở tầng field chính; muốn phân biệt, đọc `check_in_time`/`check_out_time` nào là `null`).
5. **`zone`** hiển thị = zone của dòng ĐẠI DIỆN (zone nơi diễn ra sự kiện `in`, hoặc zone nơi diễn ra sự kiện `out` độc lập nếu EX2) — SRS không yêu cầu hiển thị 2 cổng khác nhau cho vào/ra trong 1 phiên.
6. **List KHÔNG trả `imageUrl`, Detail (`GET /:id`) MỚI trả `imageUrl`** — giữ nguyên quyết định cũ.
7. **Sắp xếp**: `ORDER BY COALESCE(check_in_time, check_out_time) DESC` — mốc thời gian sớm nhất có thật của phiên, hard-code.
8. **Giới hạn đã biết**: `GET /:id` chỉ nhận `id` là id của dòng ĐẠI DIỆN (id trả về từ danh sách). Nếu client tự truyền id của dòng `out` đã bị hấp thụ vào 1 phiên hoàn tất (không xuất hiện độc lập trong list), API trả `404` — chấp nhận vì client luôn lấy `id` từ response list trước khi gọi detail, không tự đoán id.

---

## 3. Scope (UC-117)

### TRONG scope
1. **GET** `/api/v1/gate-access/history` — own, `JwtAuthGuard`, filter `from`/`to`/`zoneId`, phân trang, 1 dòng/1 phiên, KHÔNG `imageUrl`.
2. **GET** `/api/v1/gate-access/history/:id` — chi tiết 1 phiên CỦA MÌNH (ownership fold vào query qua `user_id` của dòng đại diện — không thuộc/không tồn tại → 404), CÓ `imageUrl`.
3. **GET** `/api/v1/gate-access/admin/history` — Admin/Manager, `PermissionsGuard + @RequirePermissions('gate_access.history.read_all')`, filter `from`/`to`/`zoneId`/`userId`/`departmentId`, phân trang, output CÓ thêm `userId`.
4. **GET** `/api/v1/gate-access/admin/history/:id` — chi tiết bất kỳ phiên nào, CÓ `imageUrl` + `userId`.
5. Logic self-join gộp 1 phiên/1 dòng theo công thức §0.2, `session_status` derived (`completed`/`incomplete`) — KHÔNG lưu DB.
6. Migration seed permission `gate_access.history.read_all` — GIỮ NGUYÊN (roles `SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER`).
7. Wiring vào module `gate-access` (đã tạo ở GAP-001).

### NGOÀI scope (UC sau — KHÔNG làm ở đây)
- Ghép cặp `paired_log_id`/`duration_seconds` — đã làm ở GAP-001 (UC-116), feature này chỉ ĐỌC.
- Thống kê lưu lượng (UC-114 — feature riêng, đã đổi sang nguồn `iot_device_events`, KHÔNG còn liên quan `gate_access_logs`).
- Xuất báo cáo PDF/Excel (UC-127 — Bước 5).
- JOIN `iot_device_events`/`media_files` để lấy ảnh thật — residual.
- Sửa/xóa `gate_access_logs` — READ-ONLY tuyệt đối.
- Cho phép `GET /:id` tự resolve khi client truyền id của dòng `out` đã hấp thụ (§2 mục 8 — giới hạn đã biết, KHÔNG làm thêm logic resolve).

---

## 4. DTO (đề xuất — mô tả, KHÔNG code)
- **`ListGateAccessHistoryQueryDto`**: `page`/`limit` (limit max 100), `from?`/`to?` (`@IsOptional @IsISO8601`), `zone_id?` (`@IsOptional @IsUUID`).
- **`ListGateAccessHistoryAdminQueryDto extends ListGateAccessHistoryQueryDto`**: thêm `user_id?`, `department_id?` (đều `@IsOptional @IsUUID`).
- **`GateAccessHistoryItemDto`** (list, KHÔNG `imageUrl`): `id`, `zone_id`, `zone_code`, `zone_name`, **`check_in_time` (nullable)**, **`check_out_time` (nullable)**, `duration_seconds` (nullable), `plate_number`, `session_status` (`'completed'|'incomplete'`). Route admin thêm `user_id`.
- **`GateAccessHistoryDetailDto extends GateAccessHistoryItemDto`**: thêm `image_url`.

## 5. Service (đề xuất — `GateAccessHistoryService` mới, module `gate-access`, raw SQL)
- Constructor: `private readonly dataSource: DataSource` (đổi từ `@InjectRepository` — self-join CASE phức tạp, raw SQL rõ ràng hơn).
- **Câu SQL nền tảng dùng chung** (tham số hoá `WHERE` động, mirror `VehicleHistoryService.applyFilters`):
```sql
SELECT
  l.id,
  l.zone_id, z.zone_code, z.zone_name,
  l.user_id,
  l.plate_number,
  l.metadata_json,
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
[LEFT JOIN users u ON u.id = l.user_id]  -- CHỈ khi filter department_id
WHERE (l.direction = 'in' OR l.paired_log_id IS NULL)
  AND ...filter động...
ORDER BY COALESCE(check_in_time, check_out_time) DESC
```
- `listForUser(userId, query)`: thêm `AND l.user_id = $n`, KHÔNG JOIN `users`. Map → `GateAccessHistoryItemDto[]` (KHÔNG `user_id`/`image_url`).
- `listAll(query: ListGateAccessHistoryAdminQueryDto)`: thêm optional `AND l.user_id = $n` (nếu `userId`); JOIN `users` + `AND u.department_id = $n` CHỈ khi có `departmentId`. Map → CÓ `user_id`.
- `getDetailForUser(id, userId)`: câu SQL trên + `WHERE l.id = $1 AND l.user_id = $2` (fold ownership, mirror `loadOwned` UC1) → không có dòng → `NotFoundException({code:'GATE_ACCESS_LOG_NOT_FOUND', message:'Không tìm thấy lịch sử ra vào'})` → map `GateAccessHistoryDetailDto` (đọc thêm `image_url` từ `metadata_json`).
- `getDetailAny(id)`: `WHERE l.id = $1`, không ràng buộc ownership.
- `private buildWhere(query, extra?)`: build đoạn `WHERE`/`params` động dùng chung list own/admin (mirror `applyFilters` UC7) — `from`/`to` so trên `COALESCE(check_in_time, check_out_time)` KHÔNG dùng được trực tiếp trong `WHERE` (alias chưa có ở tầng WHERE của cùng SELECT) → filter `from`/`to` thực chất áp trên `l.access_time` (mốc thời gian của dòng đại diện) — ĐỦ đúng nghiệp vụ vì dòng đại diện luôn có `access_time` là mốc sớm nhất có thật của phiên khi tồn tại (`in` time khi có, `out` time khi EX2).
- `private toItemDto(row, includeUserId)` / `private toDetailDto(row, includeUserId)`: mapper thuần đọc từ raw row (`snake_case` từ SQL), `image_url` = `row.metadata_json?.imageUrl ?? null` (an toàn khi `metadata_json` là `null`).

## 6. Controller (đề xuất — `GateAccessHistoryController` mới, module `gate-access`) — KHÔNG đổi so với bản trước
- `@Controller('gate-access')`.
- `@Get('history')` `@UseGuards(JwtAuthGuard)` → `listForUser(@CurrentUser() user, @Query() query)`.
- `@Get('history/:id')` `@UseGuards(JwtAuthGuard)` `ParseUUIDPipe` → `getDetailForUser(id, user.userId)`.
- `@Get('admin/history')` `@UseGuards(JwtAuthGuard, PermissionsGuard)` `@RequirePermissions('gate_access.history.read_all')` → `listAll(query)`.
- `@Get('admin/history/:id')` cùng guard/permission, `ParseUUIDPipe` → `getDetailAny(id)`.

## 7. Requirements (EARS)
- **R1**: **WHEN** nhân viên đã đăng nhập gửi `GET /gate-access/history` **→** hệ thống trả danh sách PHIÊN (1 dòng/1 phiên, gồm `check_in_time` VÀ `check_out_time` trong cùng dòng) CHỈ của chính họ, sắp xếp giảm dần, phân trang chuẩn.
- **R2 (crux)**: **THE system SHALL** loại bỏ dòng `direction='out'` ĐÃ GHÉP (`paired_log_id IS NOT NULL`) khỏi tập kết quả riêng — dòng đó PHẢI được biểu diễn qua `check_out_time` của dòng `in` tương ứng, KHÔNG xuất hiện thành 1 dòng riêng.
- **R3**: **WHEN** nhân viên gửi `GET /gate-access/history/:id` với `id` thuộc phiên của chính họ **→** hệ thống trả chi tiết KÈM `image_url`.
- **R4**: **IF** `id` không tồn tại, thuộc phiên người khác, hoặc là id của dòng `out` đã hấp thụ vào phiên khác (route own) **→** `404`, thông điệp trung tính.
- **R5**: **WHEN** Admin/Manager gửi `GET /admin/history` với filter bất kỳ tổ hợp **→** hệ thống trả đúng tập lọc, output CÓ thêm `user_id`.
- **R6**: **IF** user không có quyền `gate_access.history.read_all` mà gọi route `admin/*` **→** `403`.
- **R7**: **WHILE** JOIN `zones` **→** hệ thống LUÔN kèm `zones.deleted_at IS NULL` trong mệnh đề JOIN.
- **R8**: **THE system SHALL** tính `session_status='completed'` khi `paired_log_id IS NOT NULL`, ngược lại `'incomplete'`.
- **R9**: **IF** không có phiên nào khớp filter **→** danh sách rỗng + `meta.total=0`, KHÔNG lỗi.

## 8. Constitution
- **SEC-01**: Route own dùng `JwtAuthGuard` (KHÔNG `PermissionsGuard`).
- **SEC-02**: Route admin bắt buộc `JwtAuthGuard + PermissionsGuard + @RequirePermissions('gate_access.history.read_all')`.
- **SEC-03**: Ownership route own fold vào `WHERE l.user_id = $n` trong CÙNG câu SQL, KHÔNG load-rồi-so-sánh; bind tham số cho MỌI filter động (raw SQL, SEC-03 nghiêm ngặt hơn khi dùng raw SQL — TUYỆT ĐỐI không nội suy chuỗi).
- **ARCH-01**: File mới hoàn toàn, thêm vào module `gate-access` — KHÔNG đụng `GateAccessPairingService`.
- **DATA-01**: READ-ONLY tuyệt đối trên `gate_access_logs`.
- **DATA-02 (crux)**: Mọi JOIN `zones` PHẢI kèm `z.deleted_at IS NULL`.
- **DATA-03 (crux, MỚI)**: Công thức lọc 1-dòng/1-phiên `WHERE (l.direction = 'in' OR l.paired_log_id IS NULL)` PHẢI có mặt trong CẢ 4 method (list own/admin, detail own/admin) — thiếu điều kiện này sẽ tái phát lỗi hiển thị trùng 2 dòng/1 phiên đã sửa ở bản revise này.
- **VAL-01**: DTO validate chuẩn; `:id`/`zone_id`/`user_id`/`department_id` qua UUID; `from`/`to` qua `@IsISO8601`.
- **PERM-01**: permission `gate_access.history.read_all` GIỮ NGUYÊN.
- **NO-SCOPE-01**: KHÔNG tự làm UC-114/UC-116 ở đây.

## 9. Residuals / known-gaps
- **Ảnh chụp thật** — chưa làm, chỉ đọc field optional trong `metadata_json`.
- **`GET /:id` không tự resolve id của dòng `out` đã hấp thụ** — giới hạn đã biết (§2 mục 8), chấp nhận.
- **Tổng thời lượng theo ngày** — vẫn ngoài scope UC-117 (per-session, không phải per-day) — dời báo cáo UC-127.
- **Filter theo `session_status`** — SRS không yêu cầu, không thêm.

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md của cả 3 UC Bước 2 trước khi cho phép code. KHÔNG tự code khi chưa có xác nhận.
