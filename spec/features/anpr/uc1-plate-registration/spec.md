# VPR-001 — UC1 (ANPR): đăng ký biển số xe

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo spec VPR-001 (UC1): user đăng ký biển số xe của mình vào `vehicle_registrations`. Crux = normalizePlate dùng chung với UC4. RECON code thật (controller/service/envelope/@CurrentUser/conflict). OQ chờ chốt. | Toàn bộ |
| 2026-06-24 | Thiếu Chủ CHỐT OQ-1…OQ-5: OQ-1=CẢ HAI route (user JWT + admin real-gate, 2 DTO tách) · OQ-2=KHÔNG map O↔0/I↔1 · OQ-3=409 PLATE_ALREADY_REGISTERED (không lộ user giữ biển) · OQ-4=`^[0-9A-Z]+$` dài 6–10 + ≥1 chữ & ≥1 số · OQ-5=`vehicle_type` free-text(50). §8 đánh dấu ĐÃ CHỐT. | §8, §1, §2, §5 |

> **SPEC-ONLY.** Chưa plan/tasks/code. Nền schema VRS-001 (Setup-0) đã commit (bảng + entity + module). UC1 chỉ thêm DTO + util normalize + service + 1 route POST. KHÔNG migration (bảng đã có), KHÔNG camera/bridge.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Entity đích ([vehicle-registration.entity.ts](../../../../src/modules/anpr/entities/vehicle-registration.entity.ts))
- Cột thật (để DTO map đúng): `id`(uuid PK), `userId`→`user_id`, `plateNumber`→`plate_number`(varchar16), `plateRaw`→`plate_raw`(varchar20), `vehicleType`→`vehicle_type`(varchar50 null), `note`(varchar255 null), `status`(varchar30 default `'active'`), `createdAt`/`updatedAt`/`deletedAt` (soft-delete). Relation `@ManyToOne UserEntity onDelete CASCADE` qua `user_id`.
- DB (Setup-0, đã chạy thật): partial unique `plate_number WHERE deleted_at IS NULL` + index `user_id`.

### 0.2. Controller + service CRUD mẫu để mirror ([iot-devices.controller.ts:37-90](../../../../src/modules/iot/controllers/iot-devices.controller.ts))
- `@Controller('iot-devices')`; mỗi route `@UseGuards(JwtAuthGuard, MockPermissionsGuard)` + decorator mock `Permissions(...)` (khai báo cục bộ trong controller — pattern lặp toàn repo, vd [ivss-presence.controller.ts:16-24](../../../../src/modules/ivss/controllers/ivss-presence.controller.ts)).
- **Envelope chuẩn = trả TAY inline** `{ success: true, message: '...', data, meta? }` ([:49-54](../../../../src/modules/iot/controllers/iot-devices.controller.ts)). **KHÔNG có global interceptor** bọc envelope ([main.ts](../../../../src/main.ts) — grep `useGlobalInterceptors`/`useGlobalPipes` = 0 match) → validation cũng per-controller.
- Validation per-route: `@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))` ([:74-80](../../../../src/modules/iot/controllers/iot-devices.controller.ts)).
- Service inject `private readonly iotDevicesService` (controller→service). Service repo: dự án có 2 kiểu — **`@InjectRepository(Entity) Repository<Entity>`** ([is-department-code-unique.validator.ts:14-17](../../../../src/modules/accounts/validators/is-department-code-unique.validator.ts)) HOẶC `DataSource` raw query (ivss). Với entity đã `forFeature` (AnprModule) → mirror `@InjectRepository`.

### 0.3. Lấy user đang đăng nhập từ JWT ([current-user.decorator.ts](../../../../src/modules/auth/decorators/current-user.decorator.ts))
- `@CurrentUser()` → `{ userId: string } | undefined` (đọc `request.user`). Một số controller dùng trực tiếp `req.user?.userId` ([iot-devices.controller.ts:87](../../../../src/modules/iot/controllers/iot-devices.controller.ts)). `JwtAuthGuard` gắn `request.user.userId`. ⇒ UC1 lấy `user_id` từ `@CurrentUser()`, **KHÔNG tin body**.

### 0.4. Xử lý trùng/conflict ([iot-devices.service.ts:102-122](../../../../src/modules/iot/services/iot-devices.service.ts))
- Pattern: **pre-check tồn tại → `throw new ConflictException({ code, message })`** (vd `code:'DEVICE_CODE_EXISTS'`). HTTP 409. KHÔNG có exception filter dịch lỗi DB `23505` → hiện dự án **chặn bằng pre-check**, không dựa lỗi Postgres thô. (Hệ quả cho UC1: cần pre-check + safety-net bắt 23505 — xem OQ-3.)

### 0.5. Tiền lệ NORMALIZE dùng chung ([create-iot-device.dto.ts:13,39](../../../../src/modules/iot/dto/create-iot-device.dto.ts))
- `normalizeMacAddress` đặt ở **util chung** `common/utils/mac.util.ts`, gọi qua `@Transform(({value})=>normalizeMacAddress(value))` trong DTO. ⇒ tiền lệ rõ: hàm normalize **để ở util riêng + dùng `@Transform`**, KHÔNG nhúng trong service. UC1 `normalizePlate` mirror cách này (đặt `src/modules/anpr/utils/normalize-plate.ts`) để UC4 dùng lại.

### 0.6. DTO style ([create-iot-device.dto.ts:15-45](../../../../src/modules/iot/dto/create-iot-device.dto.ts))
- `class-validator` (`@IsString/@IsNotEmpty/@MaxLength/@IsOptional/@IsEnum`) + `class-transformer` (`@Expose({name:'snake_case'})`, `@Transform`). DTO nhận body snake_case, map sang camelCase.

---

## 1. Scope (UC1)

### TRONG scope
1. **2 DTO tách** (OQ-1): `CreateVehicleRegistrationDto` (user — `plate_raw` required, `vehicle_type?`, `note?`, KHÔNG `user_id`) + `AdminCreateVehicleRegistrationDto` (admin — thêm `user_id` required).
2. **Util chung** `normalizePlate(raw): string` (`src/modules/anpr/utils/normalize-plate.ts`) — DÙNG CHUNG với UC4.
3. **Service** `VehicleRegistrationService.register(userId, dto)`: normalize → validate format → pre-check trùng → tạo bản ghi (`plate_raw` + `plate_number` + `status='active'` + `user_id`). Dùng chung cho cả 2 route.
4. **Controller** 2 route (OQ-1): user `POST /api/v1/anpr/vehicle-registrations` (JWT, `user_id` từ `@CurrentUser()`) + admin route (admin-gated THẬT, `user_id` từ body). Envelope chuẩn, trả bản ghi tạo.

### NGOÀI scope (UC sau — KHÔNG làm)
- KHÔNG webhook/ingestion đọc biển từ camera (UC4–5). KHÔNG sửa/disable/xóa biển (UC2). KHÔNG list/xem biển (UC3). KHÔNG bridge/NetSDK/thiết bị. KHÔNG migration (bảng đã có).

## 2. DTO (đề xuất — mô tả, KHÔNG code) — 2 DTO tách (OQ-1)
`CreateVehicleRegistrationDto` (user, mirror §0.6):
- `plate_raw`: `@Expose('plate_raw')` + `@IsString @IsNotEmpty @MaxLength(20)`. (biển gốc hiển thị.)
- `vehicle_type?`: `@IsOptional @IsString @MaxLength(50)` (OQ-5 free-text). `note?`: `@IsOptional @IsString @MaxLength(255)`.
- **KHÔNG** nhận `user_id`/`plate_number`/`status` từ body (server tự gắn) — route user lấy `user_id` từ JWT.

`AdminCreateVehicleRegistrationDto` (admin):
- Kế thừa các field trên + `user_id`: `@Expose('user_id') @IsUUID` **required** (admin đăng ký hộ user bất kỳ).
- Vẫn KHÔNG nhận `plate_number`/`status` từ body.
- Format biển: validate trên giá trị **đã normalize** (OQ-4) — custom validator hoặc check trong service trước pre-check.

## 3. CRUX — `normalizePlate(raw): string` (util dùng chung UC1 + UC4)
**Phép biến đổi, theo thứ tự:**
1. `String(raw)` → `.trim()`.
2. `.toUpperCase()`.
3. Loại MỌI ký tự KHÔNG thuộc `[A-Z0-9]` (bỏ khoảng trắng, `-`, `.`, `,`, ký tự lạ). Giữ chữ + số.
- Ví dụ: `"30A-123.45"` → `"30A12345"`; `" 51f 678.90 "` → `"51F67890"`.
- **Đặt ở `src/modules/anpr/utils/normalize-plate.ts`** (mirror `mac.util.ts`, §0.5). **BẮT BUỘC dùng chung**: UC4 (camera đọc biển) PHẢI gọi đúng hàm này thì `plate_number` mới khớp DB. KHÔNG nhúng riêng trong service UC1.
- ⚠ **Quyết định ảnh hưởng độ khớp → OQ-2**: có ánh xạ nhầm-lẫn `O↔0`, `I↔1` (biển VN dễ nhầm) hay KHÔNG. Đưa thành OQ, KHÔNG tự quyết (ép sai sẽ phá khớp ở cả 2 chiều đăng ký/đọc camera).

## 4. Service (đề xuất)
`VehicleRegistrationService.register(userId: string, dto): Promise<VehicleRegistrationEntity>`:
1. `plateNumber = normalizePlate(dto.plate_raw)`.
2. Validate format `plateNumber` (OQ-4) → fail → `BadRequestException({code:'INVALID_PLATE', ...})`.
3. **Pre-check trùng** (§0.4): tồn tại bản ghi `plate_number = plateNumber AND deleted_at IS NULL` → `ConflictException({code:'PLATE_ALREADY_REGISTERED', ...})` (OQ-3).
4. `repo.save({ userId, plateRaw: dto.plate_raw, plateNumber, vehicleType, note, status:'active' })`.
5. **Safety-net**: bắt lỗi DB `23505` (partial unique) → dịch thành cùng `ConflictException` sạch (KHÔNG để 23505 phọt client) (OQ-3).
- Inject `@InjectRepository(VehicleRegistrationEntity)` (§0.2). SEC-03: nếu raw SQL thì bind tham số (ở đây dùng repo).

## 5. Controller (đề xuất) — 2 route (OQ-1)
- **User route**: `POST /api/v1/anpr/vehicle-registrations` — `@UseGuards(JwtAuthGuard)`, `userId` từ `@CurrentUser()` (§0.3), body = `CreateVehicleRegistrationDto` (KHÔNG `user_id`).
- **Admin route**: `POST /api/v1/anpr/admin/vehicle-registrations` (path chốt theo tiền lệ admin repo — RECON ở plan) — **admin-gated THẬT** (`PermissionsGuard` thật + `@RequirePermissions(...)`, KHÔNG chỉ JwtAuthGuard), body = `AdminCreateVehicleRegistrationDto` (`user_id` từ body).
- Cả 2: `@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))`, gọi `service.register(userId, dto)`, trả envelope `{ success:true, message:'Vehicle registered successfully', data }` (§0.2), HTTP 201.

## 6. Requirements (EARS)
- **R1**: **WHEN** user đã xác thực gửi `POST` với `plate_raw` hợp lệ **→** hệ thống normalize `plate_raw` thành `plate_number`, lưu bản ghi (`plate_raw` + `plate_number` + `status='active'` + `user_id`=current user) và trả 201 + envelope.
- **R2**: **WHILE** tạo bản ghi, hệ thống PHẢI gắn `user_id` = current user từ JWT, **KHÔNG** lấy `user_id` từ body (trừ khi OQ-1=admin route).
- **R3**: **IF** `plate_number` (sau normalize) đã tồn tại ở bản ghi đang sống (`deleted_at IS NULL`) **→** trả `409 ConflictException` (`PLATE_ALREADY_REGISTERED`), KHÔNG tạo trùng.
- **R4**: **IF** DB ném `23505` (partial unique, race) **→** hệ thống bắt và dịch thành 409 sạch, **KHÔNG** để lỗi Postgres thô phọt ra client.
- **R5**: **IF** `plate_raw` rỗng/không hợp lệ hoặc `plate_number` sau normalize không đạt format (OQ-4) **→** trả `400/422` với mã lỗi rõ, KHÔNG lưu.
- **R6**: **WHEN** UC4 (camera) cần khớp biển **→** PHẢI gọi cùng `normalizePlate` của UC1 (single source of truth).

## 7. Constitution
- **SEC-01 (ai đăng ký)**: chỉ user đã đăng nhập (`JwtAuthGuard`) được đăng ký; `user_id` = current user từ JWT, KHÔNG tin body (OQ-1 nếu mở admin route thì admin-gated + cho phép `user_id` body).
- **ARCH-01 (pattern)**: controller → service → repository (`@InjectRepository`), mirror iot-devices; KHÔNG business logic trong controller; KHÔNG raw SQL nghiệp vụ nếu repo đủ.
- **ARCH-02 (normalize dùng chung)**: `normalizePlate` ở `anpr/utils/normalize-plate.ts` (util chung), KHÔNG nhúng trong service — UC4 tái dùng.
- **DATA-01 (normalize-trước-lưu + đúng bảng)**: normalize TRƯỚC khi lưu; ghi `plate_raw` (gốc) + `plate_number` (chuẩn) + `status='active'` vào `vehicle_registrations`; pre-check/uniqueness chỉ xét `deleted_at IS NULL`.
- **DATA-02 (no-migration)**: bảng đã tồn tại (Setup-0) — KHÔNG migration.
- **VAL-01 (validate input)**: DTO `class-validator` + `ValidationPipe({whitelist,transform})` (mirror); `plate_raw` required + maxLength 20; `vehicle_type`/`note` optional maxLength; `plate_number` sau normalize đạt format (OQ-4).
- **VAL-02 (conflict sạch)**: trùng biển → 409 mã rõ, KHÔNG lộ `23505`/stack DB.

## 8. OPEN QUESTIONS — ĐÃ CHỐT
- **OQ-1 (crux) ai đăng ký — CHỐT: CẢ HAI route.** (a) **User**: `POST /api/v1/anpr/vehicle-registrations`, `user_id` từ `@CurrentUser()` JWT, DTO user **KHÔNG** có `user_id`. (b) **Admin**: route admin (path theo tiền lệ repo — RECON ở plan), DTO admin **CÓ** `user_id` (required), **admin-gated THẬT** (guard/permission admin, KHÔNG chỉ JwtAuthGuard). **2 DTO tách**: `CreateVehicleRegistrationDto` (user, không user_id) vs `AdminCreateVehicleRegistrationDto` (admin, có user_id). Service `register(userId, dto)` dùng chung cho cả 2 (controller quyết nguồn userId).
- **OQ-2 (crux) normalize — CHỐT: KHÔNG map O↔0/I↔1.** `normalizePlate` chỉ: trim → toUpperCase → strip mọi ký tự ngoài `[A-Z0-9]`. Comment trong util ghi rõ: "KHÔNG map nhầm-lẫn O/0,I/1 — xử OCR ở UC4".
- **OQ-3 trùng biển — CHỐT**: `409 ConflictException({ code:'PLATE_ALREADY_REGISTERED', message:'Biển số này đã được đăng ký' })`. **KHÔNG** tiết lộ user nào đang giữ biển (SEC — tránh rò thông tin user khác).
- **OQ-4 validate format — CHỐT**: sau normalize `^[0-9A-Z]+$`, **độ dài 6–10**, **≥1 chữ cái VÀ ≥1 chữ số**. Fail → `BadRequestException({ code:'INVALID_PLATE', ... })`.
- **OQ-5 `vehicle_type` — CHỐT**: free-text `@MaxLength(50)` (KHÔNG enum).

## 9. Residuals / known-gaps
- **Đồng bộ UC4**: `normalizePlate` là hợp đồng chung; mọi thay đổi (đặc biệt OQ-2) phải kiểm lại UC4 — ghi rõ khi làm UC4.
- **Race trùng biển**: pre-check + 23505 safety-net đủ cho v1; không khóa phân tán.
- **`MockPermissionsGuard`/`Permissions`**: toàn repo đang mock (chưa có RBAC thật) — UC1 mirror mock; quyền thật là việc chung của hệ thống (defer).
- **Envelope**: trả tay inline (không interceptor) — UC1 theo đúng vậy; nếu sau này thêm global interceptor thì refactor chung.
- **Chưa xác định**: tên permission chuẩn cho ANPR (`anpr.vehicle.register` là đề xuất, chưa có trong seed permissions) — cần đối chiếu khi RBAC thật.

> **STOP.** Spec-only. Chờ Thiếu Chủ review §0 RECON + chốt OQ-1…OQ-5 trước khi sang plan/tasks. KHÔNG tự code.
