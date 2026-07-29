# SRCH-01 — (Không có UC gốc SRS — "nice-to-have" theo `Plan.md` mục 2.E) Tìm kiếm tổng hợp đa nguồn (Global Search)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-29 | Tạo spec. Nguồn gốc: `Plan.md` (root repo) mục 2.E — "ưu tiên thấp, nice-to-have, không phải yêu cầu cứng cho đồ án". Module `search` MỚI HOÀN TOÀN, chưa có code trước đó. RECON code thật cho 5 loại resource + cơ chế check-permission tầng service (`AuthzReadRepository`). 4 quyết định nghiệp vụ đã chốt qua AskUserQuestion — xem §1. | Toàn bộ |

> Nguồn gốc: `Plan.md` mục 2.E. Không có UC gốc chính thức trong SRS — mirror cách đặt tên "no UC gốc" của `feat-notification-inbox`.
>
> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md trước khi cho phép code.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Module `search`: KHÔNG tồn tại
Xác nhận `src/modules/search/` chưa có — feature này tạo module hoàn toàn mới.

### 0.2. Permission đọc + field search hiện có của 5 loại resource

| type | Entity | Permission đọc hiện có | Field search (ILIKE) |
|---|---|---|---|
| `zone` | `ZoneEntity` (`src/modules/zones/entities/zone.entity.ts`) | `zones.zone.read` (4 role kể cả EMPLOYEE) | `zoneCode`, `zoneName` |
| `device` | `IoTDeviceEntity` (`src/modules/iot/entities/iot-device.entity.ts`) | `iot.device.read` (MANAGER, SYSTEM_ADMIN, + BUSINESS_ADMIN sau [IOT-GAP-01](../../iot/feat-grant-business-admin-device-read/spec.md)) | `deviceCode`, `deviceName` |
| `vehicle` | `VehicleRegistrationEntity` (`src/modules/anpr/entities/vehicle-registration.entity.ts`) | `anpr.vehicle.admin_read` (route `GET /anpr/admin/vehicle-registrations`, `vehicle-registration.controller.ts:116`, chỉ SYSTEM_ADMIN/BUSINESS_ADMIN) | `plateNumber` (đã normalize), `plateRaw` |
| `user` | `UserEntity` (`src/modules/accounts/entities/user.entity.ts`) | `accounts.user.list` (route `GET /users`, `users.controller.ts:652-654`) | `fullName`, `email`, `employeeCode` (mirror `users.service.ts:1684-1690`) |
| `meeting` | `MeetingEntity` (`src/modules/meetings/entities/meeting.entity.ts`) | `meeting.read.all` (route `GET /meetings`, `meetings.controller.ts:249-252`) | `title` (mirror `meeting-list.service.ts:66-68`: `meeting.title ILIKE :search`) |

### 0.3. Pattern ILIKE tham khảo trong codebase (KHÔNG có util search dùng chung ở `src/common`)
`vehicle-registration.service.ts:147` (`ILike` + `normalizePlate` riêng cho biển số), `departments.service.ts:524-528` (mảng OR where nhiều field), `users.service.ts:1684-1690` (OR 3 field). Feature này viết query riêng cho từng type, KHÔNG có sẵn 1 hàm search chung để tái dùng.

### 0.4. Soft-delete khác nhau giữa các entity — PHẢI xử lý đúng từng loại
- `ZoneEntity`, `VehicleRegistrationEntity`, `MeetingEntity`, `UserEntity`: có `deletedAt` — PHẢI filter `IS NULL`.
- `IoTDeviceEntity`: **KHÔNG có `deletedAt`** (xác nhận RECON, không soft-delete) — KHÔNG filter cột này (query sẽ lỗi cột không tồn tại nếu áp nhầm).

### 0.5. Check permission ở TẦNG SERVICE — `AuthzReadRepository`
`src/modules/auth/repositories/authz-read.repository.ts:13-48`, method `getEffectiveRolesAndPermissions(userId: string): Promise<{roles: string[]; permissions: string[]}>` — JOIN `user_roles→roles→role_permissions→permissions`, dedupe. Đã dùng trực tiếp (không qua guard) ở nhiều service khác (`manual-attendance.service.ts`, `meeting-notifications.service.ts`, `login.service.ts`) — pattern hợp lệ để tái dùng, KHÔNG phải hack riêng cho feature này.

### 0.6. Không có permission `search.*` nào tồn tại (đã grep xác nhận toàn bộ migration).

---

## 1. Quyết định nghiệp vụ đã chốt (AskUserQuestion, phiên 2026-07-29)

1. **Base guard: CHỈ `JwtAuthGuard`** — KHÔNG tạo permission `search.global.read` riêng. Mọi user đăng nhập gọi được endpoint; kết quả từng `type` được LỌC theo permission đọc tương ứng của user (§0.2, qua `AuthzReadRepository`) — type nào user không có quyền thì **loại khỏi response** (không trả mảng rỗng giả, không `403` toàn request).
2. **`q` tối thiểu 2 ký tự, tối đa 10 kết quả/type** — `q` < 2 ký tự → `400 VALIDATION_ERROR`, KHÔNG query DB (tránh full-scan khi user gõ 1 ký tự). Limit 10/type **hard-code**, KHÔNG expose thành query param (tránh lạm dụng, đủ cho autocomplete/quick-search).
3. **Response KHÔNG có `actionUrl`/deep-link** — chỉ trả `{type, id, label, subtitle}` tối thiểu, FE tự build route theo `type`+`id`.
4. **Việc 1 (`iot.device.read` → BUSINESS_ADMIN, spec [IOT-GAP-01](../../iot/feat-grant-business-admin-device-read/spec.md)) là dependency MỀM** — search vẫn hoạt động đúng dù IOT-GAP-01 chưa được áp: BUSINESS_ADMIN chỉ đơn giản không thấy kết quả `type=device` cho tới khi migration đó chạy, KHÔNG lỗi.

## 2. Quyết định thiết kế bổ sung

1. **Cấu trúc response: gom theo `type`** (không phải mảng phẳng lẫn lộn) — mỗi phần tử `types[]` là `{type, items[]}`, CHỈ xuất hiện nếu user có permission đọc type đó (dù `items` có thể rỗng nếu không tìm thấy kết quả nào — khác với "không có quyền" là loại hẳn key). Lý do: FE dễ dựng UI dropdown search theo từng nhóm (mirror UX phổ biến "kết quả theo danh mục"), và phân biệt rõ 2 trạng thái "không có quyền xem" vs "có quyền nhưng không tìm thấy gì".
2. **`types` query param** (optional, comma-separated, allowlist `zone,device,vehicle,user,meeting`): mặc định = cả 5 loại nếu không truyền. Giá trị không hợp lệ (typo, ví dụ `zonee`) → `400 VALIDATION_ERROR` (không âm thầm bỏ qua).
3. **Query mỗi type ĐỘC LẬP song song** (`Promise.all`), KHÔNG UNION SQL giữa các bảng khác schema (mirror nguyên tắc đã áp dụng cho `unified-feed` — dù feature đó đã bị hủy, nguyên tắc "không UNION đa bảng khác schema" vẫn đúng ở đây).
4. **Label/subtitle từng type** (không expose full entity, chỉ field cần hiển thị gợi ý):
   - `zone`: `label = zoneName`, `subtitle = "${zoneCode} · ${zoneType}"`.
   - `device`: `label = deviceName`, `subtitle = deviceCode`.
   - `vehicle`: `label = plateRaw` (hiển thị biển gốc user nhập, không phải bản normalize), `subtitle = vehicleType` (có thể `null`).
   - `user`: `label = fullName`, `subtitle = email`.
   - `meeting`: `label = title`, `subtitle = meetingCode`.
5. **Permission map cố định trong code** (KHÔNG đọc từ DB/config): `{zone: 'zones.zone.read', device: 'iot.device.read', vehicle: 'anpr.vehicle.admin_read', user: 'accounts.user.list', meeting: 'meeting.read.all'}` — nếu sau này permission-code đổi tên, phải sửa constant này (ghi rõ residual §6).
6. **Module mới `search`** — `forFeature([ZoneEntity, IoTDeviceEntity, VehicleRegistrationEntity, UserEntity, MeetingEntity])` (import entity trực tiếp từ 4 module khác, mirror nguyên tắc ARCH-02 đã áp dụng cho `campus-dashboard` — KHÔNG import `ZonesModule`/`IotModule`/`AnprModule`/`AccountsModule`/`MeetingsModule`). Import `AuthModule` để inject `AuthzReadRepository` (đã export sẵn, dùng chung với `PermissionsGuard`/service khác trong repo — KHÔNG phải cách dùng mới lạ).

---

## 3. Scope

### TRONG scope
1. `GET /api/v1/search?q=&types=zone,device,vehicle,user,meeting` — guard `JwtAuthGuard` duy nhất (KHÔNG `PermissionsGuard`/`@RequirePermissions` — lọc permission thủ công trong service, xem §2.6).
2. `SearchService.search(userId, q, types)`:
   1. `getEffectiveRolesAndPermissions(userId)` → lấy `permissions: string[]`.
   2. Với mỗi `type` trong `types` (hoặc cả 5 nếu không truyền): nếu `permissions` KHÔNG chứa permission-code map (§2.5) → bỏ qua (không query, không thêm vào response).
   3. Nếu CÓ quyền → chạy query ILIKE tương ứng, `take(10)`, map sang `{type, id, label, subtitle}`.
   4. `Promise.all` toàn bộ type còn lại, gộp thành `types: [{type, items}]`.
3. Validate `q` (`@MinLength(2)`), `types` (allowlist, optional).

### NGOÀI scope (KHÔNG làm ở đây)
- `actionUrl`/deep-link (§1.3).
- Permission `search.global.read` riêng (§1.1).
- Pagination/`limit` do client truyền (§1.2 — cố định 10/type).
- Sắp xếp theo độ liên quan (relevance ranking) — trả theo thứ tự DB (mirror convention `ORDER BY created_at`/tên đã dùng ở module gốc từng type nếu có, không thêm full-text-search/ranking engine).
- Cache kết quả search — không cần ở quy mô đồ án.

---

## 4. Requirements (EARS)

- **R1**: **WHEN** user đăng nhập gọi `GET /search?q=xyz` (không truyền `types`) **→** hệ thống search CẢ 5 loại resource, CHỈ trả về `type` mà user có permission đọc tương ứng.
- **R2**: **WHEN** `q` có độ dài < 2 **→** hệ thống trả `400 VALIDATION_ERROR`, KHÔNG query DB.
- **R3**: **WHEN** `types` chứa giá trị không thuộc allowlist (`zone,device,vehicle,user,meeting`) **→** hệ thống trả `400 VALIDATION_ERROR`.
- **R4 (crux)**: **WHEN** user KHÔNG có permission đọc 1 `type` cụ thể (dù `type` đó có trong `types` truyền vào) **→** hệ thống loại HẲN `type` đó khỏi response (KHÔNG trả `items: []`, KHÔNG `403`).
- **R5**: **WHEN** user CÓ permission đọc 1 `type` nhưng không tìm thấy bản ghi nào khớp `q` **→** hệ thống trả `{type, items: []}` (phân biệt rõ với R4).
- **R6**: **WHEN** search `type=device` **→** hệ thống KHÔNG filter theo cột `deleted_at` (entity không có soft-delete, spec §0.4) — mọi record khớp đều được xét, bất kể `status`.
- **R7**: **WHEN** search `type=zone/vehicle/meeting/user` **→** hệ thống PHẢI filter `deletedAt IS NULL`.
- **R8**: **WHEN** số kết quả khớp 1 type > 10 **→** hệ thống CHỈ trả 10 bản ghi đầu (không có thông tin "còn bao nhiêu nữa" — không pagination).

## 5. Constitution

- **ARCH-01**: Business logic (permission-filter + query từng type) nằm trong `SearchService`, controller chỉ nhận query + gọi service.
- **ARCH-02**: Module `search` KHÔNG import `ZonesModule`/`IotModule`/`AnprModule`/`AccountsModule`/`MeetingsModule` — chỉ `forFeature` entity trực tiếp + import `AuthModule` cho `AuthzReadRepository`.
- **DATA-01**: Module 100% READ-ONLY.
- **SEC-01**: Route có `JwtAuthGuard` (bắt buộc đăng nhập); permission-filter tầng service PHẢI đúng cho MỌI type — thiếu 1 type trong permission map = hở dữ liệu (residual §6, cảnh báo khi thêm type mới sau này).
- **NO-SCOPE-01**: KHÔNG thêm relevance ranking/full-text-search engine, KHÔNG cache, KHÔNG deep-link.

## 6. Residuals / known-gaps

- **Permission map hard-code trong `SearchService`** — nếu module gốc đổi permission-code (vd `zones.zone.read` đổi tên), phải nhớ sửa cả ở đây; KHÔNG có cơ chế tự động đồng bộ. Khi thêm `type` mới vào tương lai, PHẢI thêm đúng permission-code tương ứng vào map — quên thêm sẽ khiến type đó không bao giờ trả kết quả (fail-safe theo hướng "ẩn nhầm" chứ không phải "lộ nhầm", chấp nhận được).
- **Dependency mềm với [IOT-GAP-01](../../iot/feat-grant-business-admin-device-read/spec.md)** — nếu spec đó chưa được áp, BUSINESS_ADMIN gọi search vẫn `200` nhưng type `device` bị loại khỏi response (đúng R4, không phải lỗi).
- **Không có ranking theo độ liên quan** — kết quả trả theo thứ tự DB tự nhiên (thường `id`/PK order tùy DB), không sort theo "khớp gần đúng nhất". Chấp nhận được cho "nice-to-have", có thể cải tiến sau nếu team thấy cần.
- **`vehicle` chỉ search được nếu user có `anpr.vehicle.admin_read`** (2 role: SYSTEM_ADMIN, BUSINESS_ADMIN) — MANAGER/EMPLOYEE sẽ không bao giờ thấy `type=vehicle` trong search, kể cả xe của chính họ (đã có route riêng `GET /anpr/vehicle-registrations` tự-scope cho việc đó, KHÔNG phải phạm vi feature này).

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md trước khi cho phép code.
