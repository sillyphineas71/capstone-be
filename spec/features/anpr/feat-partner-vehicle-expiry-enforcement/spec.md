# VPT-001 — Biển số xe tự hết hạn theo tài khoản đối tác (mở rộng UC5 + UC-101 + accounts)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-08-12 | Tạo spec VPT-001. Nguồn: FE team viết `Docs/Nam_Sent/vehicle-spec.md`, agent đọc + đối chiếu CODE THẬT (không suy đoán), viết lại theo chuẩn Spec Kit của repo (RECON → Scope → EARS → Constitution → OPEN QUESTIONS → Residuals). Đây là **feature mới**: sửa hành vi UC5 (`vehicle-resolve.service.ts`) + mở rộng UC-101 (admin response) + 2 endpoint mới (1 ở module `anpr`, 1 ở module `accounts`). | Toàn bộ |
| 2026-08-12 | 2 quyết định đã chốt với Thiếu Chủ TRƯỚC khi viết spec này (qua trao đổi trực tiếp, không phải trong file): (1) permission cho route xoá hộ admin là **`anpr.vehicle.admin_delete`** (tạo mới, không tái dùng `admin_register`); (2) `account_expires_at` thêm **top-level** vào `AdminVehicleRegistrationResponseDto`, đồng thời sửa lại comment SEC-01 cho khớp. Phản ánh vào §2.6, §2.7, §6. | §2.6, §2.7, §6 |
| 2026-08-12 | Thiếu Chủ chốt tiếp 2 câu hỏi từng để mở (nguyên OQ-1/OQ-2 trong bản nháp trước khi ghi vào file): (1) **KHÔNG** làm route `GET /users/:userId/vehicles` mới, FE dùng thẳng `GET /anpr/admin/vehicle-registrations?user_id=X` đã có sẵn từ UC-101 — VPT-BE-04 coi như **không cần code**, chỉ cần thông báo lại cho FE; (2) **CÓ**, thêm điều kiện `u.deleted_at IS NULL` vào cùng bản sửa VPT-BE-01 (JOIN trong `resolveUserByPlate()`), vá luôn lớp lỗ hổng phát sinh khi admin xoá hẳn tài khoản đối tác. Chuyển 2 mục này thành quyết định 3/4 trong §6, xoá khỏi danh sách mở. Câu hỏi phần cứng (nay là OQ-3 duy nhất, §7) giữ nguyên MỞ — không phải quyết định code, không chặn tiến độ. Cập nhật §1, §2.8, §6, §7, đồng bộ lại số thứ tự §7 (OPEN QUESTIONS)/§8 (Residuals) xuyên suốt file. | §1, §2.8, §6, §7, toàn bộ tham chiếu số mục |

> **SPEC-ONLY.** Chưa plan/tasks/code. Kế thừa toàn bộ convention ANPR (normalize biển qua `normalizePlate`, ownership fold cứng `userId` ở route user, soft-delete `deletedAt IS NULL`, envelope `{success, message, data, meta}`, `ValidationPipe({whitelist,transform})`) và convention `accounts` (PTA-001: cột `users.account_expires_at`, `isPartnerAccount()`, `PartnerAccountRestrictionGuard` global). RECON đã đọc CODE THẬT — không suy đoán (§0). 4 quyết định đã chốt (§6) — KHÔNG mở lại. Còn 1 câu hỏi ngoài phạm vi code (OQ-3, phần cứng — §8), KHÔNG chặn tiến độ. Sẵn sàng sang `plan.md`.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Lỗ hổng cốt lõi ⭐ ([vehicle-resolve.service.ts:468-479](../../../../src/modules/anpr/services/vehicle-resolve.service.ts))
`resolveUserByPlate()` — nguyên văn:
```sql
SELECT id, user_id FROM vehicle_registrations
WHERE plate_number = $1 AND status = 'active' AND deleted_at IS NULL
LIMIT 1
```
Chỉ đọc `vehicle_registrations`, **KHÔNG JOIN** `users`, **KHÔNG** biết `account_expires_at`. Đây là handler thật cho port `VEHICLE_EVENT_HANDLER` (override UC4, mirror face ingestion — xem `uc5-vehicle-resolve/spec.md`). Kết quả trả `{userId, vehicleRegistrationId}` dùng để: (a) set `payload.userId`/`matchState` trong `iot_device_events`, (b) truyền vào `gateAccessLogService.writeGateLog({..., userId, vehicleRegistrationId, ...})` ([vehicle-resolve.service.ts:264-274](../../../../src/modules/anpr/services/vehicle-resolve.service.ts)).

### 0.2. `VehicleRegistrationEntity` — KHÔNG có cột hết hạn ([vehicle-registration.entity.ts](../../../../src/modules/anpr/entities/vehicle-registration.entity.ts))
Chỉ có `status`(`active`/`disabled`) + `deletedAt`. KHÔNG có `expires_at`. Xác nhận Hướng A (đọc `users.account_expires_at` tại query-time) là lựa chọn no-migration-on-vehicle-table, đúng đề xuất FE.

### 0.3. `users.account_expires_at` đã tồn tại + đã có logic ghi/đọc (PTA-001, feature trước đó) ⭐
- Cột: `UserEntity.accountExpiresAt: Date | null` ([user.entity.ts:109-110](../../../../src/modules/accounts/entities/user.entity.ts)); migration `20260811000000-AddAccountExpiresAtToUsers.ts` đã áp — `timestamptz NULL`.
- `UsersService.updateUser()` xử lý gia hạn/khoá sớm khi `PATCH /users/:id` nhận `accountExpiresAt` ([users.service.ts:1608-1630](../../../../src/modules/accounts/services/users.service.ts)) — kể cả case "hạn mới sớm hơn hạn cũ dù còn ở tương lai" (so với giá trị CŨ, không chỉ so `now()`).
- ⇒ **Đọc trực tiếp cột này tại query-time (KHÔNG cache) là đủ cho VPT-REQ-03/04** — không cần cascade-update bảng xe, không có race condition (đúng phân tích §8.2 spec FE gốc).

### 0.4. KHÔNG có index trên `users.account_expires_at`
Grep toàn bộ `src/database/migrations` cho `account_expires_at`: chỉ 1 migration (thêm cột). KHÔNG có migration index.

### 0.5. `AdminVehicleRegistrationResponseDto` — SEC-01 boundary hiện tại ([admin-vehicle-registration-response.dto.ts:8-13](../../../../src/modules/anpr/dto/admin-vehicle-registration-response.dto.ts))
Comment nguyên văn: *"Owner CHỈ `user_id` + `full_name` + `email` — KHÔNG lộ phone/department/username/employee_code/**trạng thái tài khoản** của UserEntity (SEC-01)"*. `account_expires_at` là 1 dạng "trạng thái tài khoản" → thêm field này **đi ngược nghĩa đen của comment hiện tại**, dù route đã gate `anpr.vehicle.admin_read`. Đã chốt xử lý ở §2.7/§6.

`listAll()` ([vehicle-registration.service.ts:175-216](../../../../src/modules/anpr/services/vehicle-registration.service.ts)) **đã** `leftJoinAndSelect('vr.user', 'u')` ([:183](../../../../src/modules/anpr/services/vehicle-registration.service.ts)) — `entity.user.accountExpiresAt` đã có sẵn trong entity trả về, KHÔNG cần sửa query.

### 0.6. `listAll()` ĐÃ hỗ trợ filter `user_id` từ UC-101 ⭐⭐ (phát hiện quan trọng nhất — ảnh hưởng scope VPT-BE-04)
([vehicle-registration.service.ts:197-199](../../../../src/modules/anpr/services/vehicle-registration.service.ts)):
```ts
if (query.userId) {
  qb.andWhere('vr.userId = :uid', { uid: query.userId });
}
```
Route `GET /api/v1/anpr/admin/vehicle-registrations?user_id=<uuid>` **ĐÃ TRẢ ĐÚNG DỮ LIỆU** FE cần cho "xem danh sách biển số của 1 user cụ thể" (VPT-REQ-02) — **NGAY BÂY GIỜ, không cần code gì thêm**, chỉ khác path (`/anpr/admin/vehicle-registrations?user_id=X` thay vì `/users/:userId/vehicles`). Route mới FE đề xuất ở mục 4.1 (`GET /users/:userId/vehicles`) — nếu làm — **về bản chất chỉ là 1 lớp mỏng gọi lại `vehicleRegistrationService.listAll({ userId, ...query })`**, KHÔNG có business logic mới. Đây là quyết định "có cần route mới hay dùng route sẵn có" — xem OQ-1 (§8).

### 0.7. `@AllowPartnerAccount()` + `PartnerAccountRestrictionGuard` — global guard, thiếu ở 2 route ⭐ (mức độ nghiêm trọng cao hơn FE liệt kê)
- `PartnerAccountRestrictionGuard` đăng ký **global** qua `APP_GUARD` ([app.module.ts:165](../../../../src/app.module.ts)) — áp cho MỌI route đã đăng nhập, mặc định **CHẶN** tài khoản đối tác trừ khi có `@AllowPartnerAccount()` trên handler/class ([partner-account-restriction.guard.ts:57-77](../../../../src/modules/auth/guards/partner-account-restriction.guard.ts)).
- `GET /anpr/vehicle-registrations` ([vehicle-registration.controller.ts:138-156](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)) và `GET /anpr/vehicle-history` ([vehicle-registration.controller.ts:59-77](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)) **KHÔNG có** decorator này.
- ⇒ **Đây là bug đang chặn 403 `PARTNER_ACCOUNT_RESTRICTED` ngay bây giờ** với bất kỳ tài khoản đối tác nào cố xem xe/lịch sử của chính họ — không phải "nice-to-have cho tương lai" như cách liệt kê trong spec FE gốc (mục 5). Tiền lệ đã dùng decorator này ở `auth.controller.ts`, `live-meeting.controller.ts`, `meetings.controller.ts` (grep xác nhận).

### 0.8. Permission ANPR đã seed sẵn ([20260722000006-SeedAnprVehicleAdminReadPermission.ts](../../../../src/database/migrations/20260722000006-SeedAnprVehicleAdminReadPermission.ts), [20260720000005-BackfillRolePermissions.ts:179-195](../../../../src/database/migrations/20260720000005-BackfillRolePermissions.ts))
`anpr.vehicle.admin_read`, `anpr.vehicle.admin_register`, `anpr.vehicle.history_view` đã seed cho `SYSTEM_ADMIN`+`BUSINESS_ADMIN`. **`anpr.vehicle.admin_delete` CHƯA tồn tại** — cần seed mới nếu route DELETE admin được làm (đã chốt §6).

### 0.9. Route `DELETE` hiện tại chỉ user tự xoá ([vehicle-registration.controller.ts:264-277](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts))
`softDeleteOwned(id, user.userId)` fold cứng `userId` — admin không xoá hộ được. KHÔNG có route admin tương đương.

### 0.10. `VehicleControlAlertService.evaluate()` — KHÔNG đụng, ngoài scope
Chạy song song với resolve, đối chiếu control-list (blocklist/watchlist) theo `plateNumber` — độc lập với `matchState`/`userId`. VPT-001 KHÔNG sửa service này.

---

## 1. Scope (VPT-001)

### TRONG scope
1. **VPT-BE-01 (bắt buộc — vá lỗ hổng)**: sửa `resolveUserByPlate()` trong `VehicleResolveService` — JOIN `users`, coi biển của tài khoản đã hết hạn (`account_expires_at IS NOT NULL AND account_expires_at < NOW()`) là **unmatched** (giữ nguyên semantics unmatched đã có cho biển lạ/disabled — KHÔNG thêm nhánh xử lý mới).
2. **VPT-BE-02**: migration thêm index `idx_users_account_expires_at` (partial, `WHERE account_expires_at IS NOT NULL`).
3. **VPT-BE-03**: test case cho VPT-BE-01 trong `vehicle-resolve.service.spec.ts` (mirror style mock đã có).
4. **VPT-BE-07 (nâng ưu tiên — bug sống)**: thêm `@AllowPartnerAccount()` cho `GET /anpr/vehicle-registrations` + `GET /anpr/vehicle-history`.
5. **VPT-BE-05**: route `DELETE /anpr/admin/vehicle-registrations/:id` (admin xoá hộ), permission mới `anpr.vehicle.admin_delete` (đã chốt §6) + migration seed.
6. **VPT-BE-06**: thêm `account_expires_at: Date | null` **top-level** vào `AdminVehicleRegistrationResponseDto` (đã chốt §6), sửa comment SEC-01.
7. **VPT-BE-04 — ĐÃ CHỐT: KHÔNG code** (§6 quyết định 3). FE dùng thẳng `GET /anpr/admin/vehicle-registrations?user_id=X` đã có sẵn từ UC-101 (§0.6) — không tạo route `GET /users/:userId/vehicles` mới.
8. **VPT-BE-01 mở rộng — ĐÃ CHỐT** (§6 quyết định 4): thêm điều kiện `u.deleted_at IS NULL` vào cùng câu JOIN của VPT-BE-01 (§2.1) — vá luôn trường hợp admin xoá hẳn tài khoản đối tác thay vì chỉ đặt hạn quá khứ.

### NGOÀI scope
- **Hướng B** (thêm cột `expires_at` vào `vehicle_registrations` + cascade update): KHÔNG làm — FE tự đề xuất hoãn (mục 3 spec FE gốc), đúng nguyên tắc "ADD-ONLY khi thật sự cần" (CLAUDE.md §5.4). Chỉ cân nhắc lại nếu có bằng chứng JOIN chậm ở volume lớn.
- **KHÔNG** đụng `VehicleControlAlertService` (blocklist/watchlist — §0.10).
- **KHÔNG** đụng `login.service.ts`/`refresh-token.service.ts` (đã xử lý `AUTH_ACCOUNT_EXPIRED` từ PTA-001, spec VPT-001 không sửa).
- **KHÔNG** tự ý xác nhận việc "mở cổng vật lý" — xem Residuals §8 (câu hỏi cho tầng phần cứng/IVSS, ngoài phạm vi code BE).
- **KHÔNG** sửa `PATCH /users/:id` (logic gia hạn/khoá sớm đã đủ dùng, §0.3).

---

## 2. Thiết kế

### 2.1. `resolveUserByPlate()` — sửa (VPT-BE-01)
Đổi raw SQL từ 1-bảng sang JOIN, thêm điều kiện hết hạn ngay trong `WHERE` (không đọc 2 query rồi so sánh ở JS — giữ đúng style raw-SQL-bind hiện có của service):

```sql
SELECT vr.id, vr.user_id
FROM vehicle_registrations vr
JOIN users u ON u.id = vr.user_id
WHERE vr.plate_number = $1
  AND vr.status = 'active'
  AND vr.deleted_at IS NULL
  AND u.deleted_at IS NULL
  AND (u.account_expires_at IS NULL OR u.account_expires_at >= NOW())
LIMIT 1
```
- `u.account_expires_at IS NULL` → nhân viên thường, không ảnh hưởng (đúng lưu ý §8.1 spec FE gốc).
- `u.deleted_at IS NULL` — **bổ sung so với spec FE gốc** (FE không đề cập, agent tự phát hiện khi đọc `UserEntity` có `@DeleteDateColumn`), **ĐÃ CHỐT làm** (§6 quyết định 4): entity `UserEntity` có soft-delete; nếu chủ xe đã bị xoá tài khoản, biển của họ **cũng phải** coi là unmatched cùng lý do bảo mật — nếu không thêm điều kiện này, xe của một tài khoản đã bị admin xoá hẳn vẫn qua được cổng.
- Không đổi `ResolvedVehicle` interface, không đổi behaviour khi không có row (vẫn `null` → unmatched, y hệt logic cũ).

### 2.2. Index (VPT-BE-02)
```sql
CREATE INDEX IF NOT EXISTS idx_users_account_expires_at
  ON users (account_expires_at)
  WHERE account_expires_at IS NOT NULL;
```
Migration mới trong `src/database/migrations/`, KHÔNG raw SQL ad-hoc ngoài migration (CLAUDE.md §5.4 quy trình chuẩn).

### 2.3. Test (VPT-BE-03)
Thêm 3 case (mirror mock `dsMock.manager.query` đã có trong `vehicle-resolve.service.spec.ts`, override nhánh `sql.includes('FROM vehicle_registrations')` giờ đổi thành JOIN — cần cập nhật matcher SQL trong file test cho khớp câu SQL mới):
1. biển hợp lệ + `account_expires_at` = hôm qua → resolve `null` (unmatched, `payload.userId = null`, `processed_status='unmatched'`).
2. biển hợp lệ + `account_expires_at = null` (nhân viên thường) → resolve như cũ.
3. biển hợp lệ + `account_expires_at` = ngày mai (đã gia hạn) → resolve như cũ.

### 2.4. `@AllowPartnerAccount()` (VPT-BE-07)
Thêm decorator (import đã tồn tại sẵn trong `common/decorators`, chỉ chưa dùng ở controller này) lên method `historyOwn()` và `list()` trong `vehicle-registration.controller.ts`. KHÔNG thêm cho route admin (`listAll`, `registerForUser`) — đúng mục 5 spec FE gốc ("Không cần cho POST admin/vehicle-registrations").

### 2.5. `DELETE /anpr/admin/vehicle-registrations/:id` (VPT-BE-05)
- Controller: đặt **trước** `DELETE /vehicle-registrations/:id` trong nhóm route admin (theo đúng tiền lệ thứ tự khai của UC-101, xem `uc101-vehicle-search/spec.md` OQ-1) — về mặt kỹ thuật KHÔNG bắt buộc (prefix literal `admin` ≠ `vehicle-registrations`, không xung đột thật) nhưng giữ nhất quán tiền lệ.
- `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('anpr.vehicle.admin_delete')` (đã chốt §6).
- Service: thêm `adminSoftDelete(id: string): Promise<void>` — KHÔNG fold `userId` (khác `softDeleteOwned`), 404 `VEHICLE_NOT_FOUND_OR_FORBIDDEN` nếu không tồn tại/đã xoá (mã lỗi theo mục 6 spec FE gốc).
- Response: `{ success: true, message: 'Vehicle deleted successfully', data: null }` (mirror route user).

### 2.6. Permission mới `anpr.vehicle.admin_delete` — ĐÃ CHỐT (§6)
Migration seed mới, gán cho đúng role đang giữ `admin_register`/`admin_read` — **PHẢI đọc lại `BackfillRolePermissions.ts`/`SeedAnprVehicleAdminReadPermission.ts` ở bước plan để copy đúng cấu trúc + đúng role**, tránh lặp bug "copy nhầm mảng role" đã ghi nhận trong comment `20260722000009-SeedIotConfigureAiPermission.ts:11`.

### 2.7. `AdminVehicleRegistrationResponseDto` — ĐÃ CHỐT (§6)
```ts
export interface AdminVehicleRegistrationResponseDto extends VehicleRegistrationResponseDto {
  owner: AdminVehicleOwner | null;
  account_expires_at: string | null; // ISO — top-level, KHÔNG nhét vào owner{}
}
```
Sửa comment SEC-01 hiện tại, giữ nguyên cảnh báo gốc (owner vẫn không lộ phone/department/username/employee_code), bổ sung 1 dòng: *"`account_expires_at` là ngoại lệ có chủ đích (VPT-REQ-06) — không phải một phần identity của `owner`, chỉ phục vụ nghiệp vụ hiển thị hạn tài khoản đối tác, route đã gate `admin_read`."* Mapper `toAdminVehicleRegistrationResponse()` đọc `entity.user?.accountExpiresAt?.toISOString() ?? null` — KHÔNG cần sửa `listAll()` (đã JOIN sẵn, §0.5).

### 2.8. `GET /users/:userId/vehicles` (VPT-BE-04) — ĐÃ CHỐT: KHÔNG LÀM
Quyết định 3 (§6): **không tạo route mới**. `GET /anpr/admin/vehicle-registrations?user_id=<uuid>` đã trả đúng dữ liệu (§0.6) — VPT-BE-04 chỉ còn việc **thông báo lại cho FE dùng route sẵn có**, không có hạng mục code nào trong `plan.md`/`tasks.md`.

---

## 3. Requirements (EARS)

- **R1 (crux — vá lỗ hổng)**: **WHEN** ANPR gửi biển số khớp 1 `vehicle_registrations` đang `active` **VÀ** chủ xe có `account_expires_at` đã qua **→** hệ thống PHẢI coi là **unmatched** (`userId=null`, `matchState='unmatched'`, `processed_status='unmatched'`) — giống hệt xử lý biển lạ/disabled hiện có, KHÔNG thêm trạng thái mới.
- **R2 (backward-compat)**: **IF** chủ xe có `account_expires_at IS NULL` (nhân viên thường/đối tác chưa từng đặt hạn) **→** hành vi resolve **KHÔNG đổi** so với trước VPT-001.
- **R3 (tức thời)**: **WHEN** admin gia hạn (`PATCH /users/:id` → `accountExpiresAt` tương lai) **→** lần resolve **NGAY SAU ĐÓ** (không cache, đọc DB trực tiếp) phải trả matched bình thường — KHÔNG cần thao tác gì trên bảng `vehicle_registrations`.
- **R4 (khoá sớm tức thời)**: **WHEN** admin đặt `accountExpiresAt` về quá khứ **→** lần resolve NGAY SAU ĐÓ phải trả unmatched.
- **R5 (partner self-service)**: **WHEN** tài khoản đối tác gọi `GET /anpr/vehicle-registrations` hoặc `GET /anpr/vehicle-history` **→** `PartnerAccountRestrictionGuard` PHẢI cho qua (không 403 `PARTNER_ACCOUNT_RESTRICTED`), trả đúng xe/lịch sử của chính họ (fold `userId` từ JWT — không đổi).
- **R6 (admin xoá hộ)**: **WHEN** admin có `anpr.vehicle.admin_delete` gọi `DELETE /anpr/admin/vehicle-registrations/:id` **→** xoá mềm bất kỳ xe nào (không fold `userId`); **IF** id không tồn tại/đã xoá **→** `404 VEHICLE_NOT_FOUND_OR_FORBIDDEN`.
- **R7 (SEC-02)**: **IF** không có `anpr.vehicle.admin_delete` **→** `403`, KHÔNG xoá.
- **R8 (hiển thị hạn)**: **WHEN** admin gọi `GET /anpr/admin/vehicle-registrations` (list/detail) **→** mỗi item trả kèm `account_expires_at` (null nếu nhân viên thường/không giới hạn).
- **R9 (SEC-03)**: mọi tham số JOIN mới (`u.account_expires_at`, `u.deleted_at`) qua bound param/literal SQL cố định trong câu query — KHÔNG nối chuỗi user input.

---

## 4. Constitution (mapping theo `spec/global/constitution.md`)

| Rule | Áp dụng VPT-001 |
| :--- | :--- |
| **SEC-01** | `account_expires_at` thêm có chủ đích vào response admin (đã gate quyền) — KHÔNG thêm field nhạy cảm khác (phone/department/status khác) vào `owner`. |
| **SEC-02** | Route `DELETE` admin mới PHẢI qua `JwtAuthGuard`+`PermissionsGuard`+`@RequirePermissions('anpr.vehicle.admin_delete')`. |
| **SEC-03** | JOIN mới trong `resolveUserByPlate()` giữ nguyên bind-param style hiện có (`$1` cho `plateNumber`), điều kiện `account_expires_at`/`deleted_at` là literal SQL cố định — không nhận input động. |
| **DATA-01** | `adminSoftDelete()` dùng `softDelete()` (soft-delete có sẵn của TypeORM trên `deletedAt`) — KHÔNG hard-delete. |
| **ARCH-01** | VPT-BE-04 KHÔNG code (§6 quyết định 3) → không phát sinh cross-module call mới; toàn bộ thay đổi còn lại nằm trong module `anpr` (trừ VPT-BE-06 đọc lại `entity.user` — quan hệ ORM đã khai sẵn, không phải service call chéo). |
| **ARCH-03** | `DELETE` admin tự nhiên idempotent (xoá lần 2 → 404, không lỗi 500). |
| **ENG-01** | Test ≥80% cho nhánh mới trong `resolveUserByPlate` (3 case §2.3) + `adminSoftDelete` + response mapper. |
| **ENG-03** | Lỗi `VEHICLE_NOT_FOUND_OR_FORBIDDEN` theo format `{code, message}` sẵn có, không lộ chi tiết nội bộ. |

---

## 5. Mã lỗi (theo mục 6 spec FE gốc, đã đối chiếu luồng thật)

| HTTP | Code | Khi nào | Ghi chú đối chiếu code thật |
| :--- | :--- | :--- | :--- |
| — | `VEHICLE_OWNER_ACCOUNT_EXPIRED` | Biển hợp lệ nhưng chủ xe hết hạn | **KHÔNG phải HTTP response thật** — `onVehicleEvent()` là webhook nội bộ, luôn NotThrow/ACK 200 (mirror face ingestion). Giá trị này chỉ dùng làm log-context/`matchState` nội bộ nếu cần phân biệt lý do unmatched sau này (hiện tại unmatched không phân biệt lý do — KHÔNG có trong scope VPT-001, xem Residuals §8). |
| `404` | `VEHICLE_NOT_FOUND_OR_FORBIDDEN` | Admin xoá xe không tồn tại/đã xoá | Dùng đúng như spec FE gốc cho `adminSoftDelete()`. |

---

## 6. QUYẾT ĐỊNH ĐÃ CHỐT

> Chốt trực tiếp với Thiếu Chủ (2 mục đầu trước khi viết spec, 2 mục sau qua rà soát OPEN QUESTIONS ngay trong phiên viết spec này). Plan/tasks/code KHÔNG mở lại.

1. **Permission xoá hộ**: tạo **`anpr.vehicle.admin_delete`** riêng (không tái dùng `admin_register`) — nhất quán tiền lệ tách permission theo hành động của module `anpr`.
2. **`account_expires_at` trong response admin**: thêm **top-level** (không nhét trong `owner{}`), đồng thời sửa lại comment SEC-01 trong `admin-vehicle-registration-response.dto.ts` cho khớp — ghi rõ đây là ngoại lệ có chủ đích, không phải nới lỏng SEC-01 nói chung.
3. **VPT-BE-04 (route xem xe theo user)**: **KHÔNG** tạo `GET /users/:userId/vehicles` mới. `GET /anpr/admin/vehicle-registrations?user_id=X` đã trả đúng dữ liệu từ UC-101 (§0.6) — chỉ cần thông báo lại cho FE, không có code mới.
4. **VPT-BE-01 mở rộng**: thêm điều kiện `u.deleted_at IS NULL` vào cùng câu JOIN trong `resolveUserByPlate()` (§2.1) — vá luôn trường hợp admin xoá hẳn tài khoản đối tác (ngoài yêu cầu gốc của FE, agent tự phát hiện, cùng 1 bản sửa/1 test suite với VPT-BE-01).

---

## 7. OPEN QUESTIONS — còn 1 câu hỏi ngoài phạm vi code, KHÔNG chặn tiến độ

### OQ-3 — Xác nhận tầng phần cứng có tra cứu `matched`/`unmatched` để quyết định mở cổng vật lý không?
VPT-BE-01 làm đúng nghĩa vụ ở tầng dữ liệu (BE ghi nhận đúng "không hợp lệ"). Nhưng **không có API "mở cổng" nào trong `capstone-be` mà `VehicleResolveService` gọi trực tiếp** — hành vi mở barie vật lý (nếu có) nằm ở thiết bị/IVSS, ngoài code BE. Câu hỏi này không tự trả lời được từ source `capstone-be` — cần hỏi đội phần cứng (Hải, theo phân công CLAUDE.md §5.5.6) trước khi công bố "đã chặn được cổng" trong demo/báo cáo. **Không chặn việc code VPT-BE-01** (vẫn làm dù chưa có câu trả lời) — chỉ chặn việc *quảng cáo kết quả demo phần cứng*. Theo dõi ở Residuals §8, không lặp lại ở đây.

---

## 8. Residuals / known-gaps

- **Hướng B hoãn**: nếu volume `vehicle_registrations` lớn và JOIN `users` mỗi lần resolve trở thành bottleneck thật (có số liệu), cân nhắc lại thêm cột `expires_at` denormalized + cascade update — hiện chưa có bằng chứng cần ở quy mô capstone.
- **`VEHICLE_OWNER_ACCOUNT_EXPIRED` không phải HTTP code thật** (§5) — nếu sau này cần phân biệt lý do unmatched (hết hạn vs biển lạ vs disabled) cho UC6/UC7 hiển thị rõ hơn, đó là mở rộng riêng ngoài VPT-001 (hiện `matchState` chỉ có `matched`/`unmatched`, không có sub-reason).
- **`idx_users_account_expires_at` không tự động cải thiện tốc độ JOIN toàn bảng** — index chỉ hỗ trợ lookup theo `account_expires_at`, JOIN chính vẫn theo `vr.plate_number` (đã có unique partial index) rồi `u.id` (PK) — index mới chủ yếu hữu ích cho các truy vấn khác lọc theo `account_expires_at` (vd dashboard "tài khoản sắp hết hạn"), không phải bottleneck chính của `resolveUserByPlate()` (vốn đã LIMIT 1 theo PK/unique).
- **OQ-3 (§7)**: nếu câu trả lời từ đội phần cứng là "camera/IVSS tự quyết định mở cổng độc lập, không tra BE" thì VPT-001 chỉ giải quyết được phần "dữ liệu/audit trail", KHÔNG giải quyết được phần "vật lý" như tiêu đề gốc "bảo mật vật lý" của spec FE — cần ghi rõ trong release note nếu rơi vào trường hợp này.

---

> **STOP.** Spec-only. 4 quyết định §6 ĐÃ CHỐT — KHÔNG mở lại. OQ-3 (§7) là câu hỏi phần cứng ngoài phạm vi code, KHÔNG chặn tiến độ. Spec đã đủ điều kiện sang `plan.md`. Chưa viết `plan.md`/`tasks.md`, chưa code, chưa migration/seed/test/build, chưa commit — chờ Thiếu Chủ xác nhận trước khi agent viết `plan.md`.
