# VPR-001 — plan.md (UC1 ANPR: đăng ký biển số xe)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo plan VPR-001 sau spec DUYỆT + chốt OQ-1…5. 2 route (user JWT + admin real-gate), 2 DTO, util normalize dùng chung UC4, service pre-check+23505 safety-net. RECON admin-gate (PermissionsGuard thật). No-migration. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. RECON bổ sung — admin-gate (đọc CODE THẬT, KẾT LUẬN)
- **PermissionsGuard THẬT tồn tại** ([permissions.guard.ts](../../../../src/modules/auth/guards/permissions.guard.ts)): đọc `@RequirePermissions(...)` ([require-permissions.decorator.ts](../../../../src/modules/auth/decorators/require-permissions.decorator.js)) qua `Reflector` → `AuthzReadRepository.getEffectiveRolesAndPermissions(userId)` → thiếu quyền → `403 ForbiddenException`.
- **Đã dùng thật trong repo** ([departments.controller.ts:40-41](../../../../src/modules/accounts/controllers/departments.controller.ts)): `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('department.create')`.
- **AuthModule export** `PermissionsGuard` + `AuthzReadRepository` ([auth.module.ts:55-81](../../../../src/modules/auth/auth.module.ts)) → module khác `imports: [AuthModule]` là dùng được guard thật (DI resolve).
- **2 pattern song song**: guard thật (accounts) vs `MockPermissionsGuard` cục bộ (iot/ivss/rooms).
- **Admin path convention**: repo gate admin **bằng PERMISSION, KHÔNG bằng path prefix** (departments POST `/departments`, không `/admin/`). Không tìm thấy tiền lệ `/admin/` path. ⇒ route admin VPR-001 đặt path riêng `anpr/admin/vehicle-registrations` (chọn rõ ràng) NHƯNG cổng thật là `PermissionsGuard` + permission admin, KHÔNG dựa path.

**KẾT LUẬN admin-gate**:
- **User route** = `@UseGuards(JwtAuthGuard)` (self-service; KHÔNG cần permission seed → không chặn người dùng thường).
- **Admin route** = `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('anpr.vehicle.admin_register')` (gate THẬT, mirror departments). AnprModule `imports: [AuthModule]`.
- ⚠ **Owed RBAC seed**: permission `anpr.vehicle.admin_register` + gán cho role admin PHẢI seed vào `permissions`/`role_permissions`, nếu không `PermissionsGuard` 403 mọi người (kể cả admin). KHÔNG tự dựng RBAC/seed trong UC1 — ghi owed, để Thiếu Chủ/seed script lo. (Test controller dùng mock guard để chứng minh wiring, không cần DB.)

## 1. Quyết định đã chốt (OQ + Constitution)
OQ-1 **2 route** (user JWT `@CurrentUser` / admin real-gate body `user_id`), **2 DTO tách** · OQ-2 normalize KHÔNG map O↔0/I↔1 · OQ-3 `409 PLATE_ALREADY_REGISTERED` (không lộ user giữ biển) · OQ-4 `^[0-9A-Z]+$` dài 6–10 + ≥1 chữ & ≥1 số → `INVALID_PLATE` · OQ-5 `vehicle_type` free-text(50).
- **SEC-01** user route lấy `user_id` từ JWT (KHÔNG body); admin route gate thật + body `user_id`. **ARCH-01** controller→service→repo `@InjectRepository`. **ARCH-02** normalize ở util chung (UC4 reuse). **DATA-01** normalize-trước-lưu, ghi `plate_raw`+`plate_number`+`status='active'`, uniqueness chỉ `deleted_at IS NULL`. **DATA-02** no-migration. **VAL-01** DTO class-validator. **VAL-02** conflict sạch, KHÔNG lộ 23505.

## 2. Util `normalizePlate` (CRUX, dùng chung UC4)
`src/modules/anpr/utils/normalize-plate.ts` — `normalizePlate(raw: string): string`:
1. `String(raw).trim()` → 2. `.toUpperCase()` → 3. strip mọi ký tự ngoài `[A-Z0-9]` (regex `/[^A-Z0-9]/g` → '').
- Comment bắt buộc: "KHÔNG map nhầm-lẫn O/0,I/1 — xử OCR ở UC4" (OQ-2).
- Mirror tiền lệ `mac.util.ts` (§0.5 spec). Export pure function (không phụ thuộc Nest) → UC4 + DTO `@Transform` + service đều gọi.

## 3. DTO (2 cái — OQ-1)
- `src/modules/anpr/dto/create-vehicle-registration.dto.ts` (user): `plate_raw` (`@Expose('plate_raw') @IsString @IsNotEmpty @MaxLength(20)`), `vehicle_type?` (`@IsOptional @IsString @MaxLength(50)`), `note?` (`@IsOptional @IsString @MaxLength(255)`). KHÔNG `user_id`.
- `src/modules/anpr/dto/admin-create-vehicle-registration.dto.ts` (admin): các field trên + `user_id` (`@Expose('user_id') @IsUUID` required). (Có thể `extends` DTO user + thêm `user_id`.)

## 4. Service `VehicleRegistrationService`
`src/modules/anpr/services/vehicle-registration.service.ts` — inject `@InjectRepository(VehicleRegistrationEntity)`.
`register(userId: string, dto): Promise<VehicleRegistrationEntity>` (dùng chung 2 route):
1. `plateNumber = normalizePlate(dto.plate_raw)`.
2. Validate format (OQ-4): `^[0-9A-Z]+$` && length 6–10 && có ≥1 `[A-Z]` && ≥1 `[0-9]` → fail → `BadRequestException({code:'INVALID_PLATE', message})`.
3. Pre-check: `repo.findOne({ where:{ plateNumber, deletedAt: IsNull() } })` → tồn tại → `ConflictException({code:'PLATE_ALREADY_REGISTERED', message:'Biển số này đã được đăng ký'})` (KHÔNG kèm user giữ biển — SEC).
4. `repo.save({ userId, plateRaw: dto.plate_raw, plateNumber, vehicleType: dto.vehicle_type ?? null, note: dto.note ?? null, status:'active' })`.
5. Safety-net: `catch` lỗi DB `23505` (driverError.code) → ném lại cùng `ConflictException PLATE_ALREADY_REGISTERED` (KHÔNG để 23505 phọt client) (VAL-02).

## 5. Controller + wiring (2 route — OQ-1)
`src/modules/anpr/controllers/vehicle-registration.controller.ts`:
- **User**: `@Post()` trên `@Controller('anpr/vehicle-registrations')`, `@UseGuards(JwtAuthGuard)`, `@UsePipes(ValidationPipe whitelist/transform)`, `register(@CurrentUser() u, @Body() CreateVehicleRegistrationDto)` → `service.register(u.userId, dto)`.
- **Admin**: `@Post()` trên path admin `anpr/admin/vehicle-registrations`, `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('anpr.vehicle.admin_register')`, `@Body() AdminCreateVehicleRegistrationDto` → `service.register(dto.user_id, dto)`.
- Cả 2: envelope inline `{ success:true, message:'Vehicle registered successfully', data }`, HTTP 201 (`@HttpCode(201)` hoặc default POST). `data` qua response-mapper (§6) tránh lộ field nội bộ.
- **Wiring** `anpr.module.ts` (Modified): `imports: [TypeOrmModule.forFeature([VehicleRegistrationEntity]), AuthModule]` (AuthModule cấp PermissionsGuard + AuthzReadRepository — §0); `controllers: [VehicleRegistrationController]`; `providers: [VehicleRegistrationService]`; giữ `exports: [TypeOrmModule]`.

## 6. File list
### Net-new
- `src/modules/anpr/utils/normalize-plate.ts` (+ `normalize-plate.spec.ts`)
- `src/modules/anpr/dto/create-vehicle-registration.dto.ts`
- `src/modules/anpr/dto/admin-create-vehicle-registration.dto.ts`
- `src/modules/anpr/dto/vehicle-registration-response.dto.ts` (mapper `toVehicleRegistrationResponse`, mirror `toIotDeviceResponse`)
- `src/modules/anpr/services/vehicle-registration.service.ts` (+ `.spec.ts`)
- `src/modules/anpr/controllers/vehicle-registration.controller.ts` (+ `.spec.ts`)
### Modified
- `src/modules/anpr/anpr.module.ts` — import AuthModule + controllers + providers.
> Tổng **9 net-new + 1 modified**. 0 migration (bảng đã có). 0 đụng module khác (chỉ import AuthModule — đã có exports).

## 7. Test (mock — KHÔNG DB thật)
- **normalizePlate** (unit, pure): `"30A-123.45"→"30A12345"`, lowercase→upper, strip space/`-`/`.`/ký tự lạ; biên OQ-4: dài 6 & 10 OK · 5 & 11 fail · toàn chữ fail · toàn số fail · có cả chữ+số OK (test format-check, có thể ở service).
- **service** (mock repo): register ok → `save` gọi với `plateNumber` chuẩn + `status:'active'` + `userId` đúng; pre-check trùng (findOne trả row) → `ConflictException PLATE_ALREADY_REGISTERED`; `save` ném 23505 → safety-net `ConflictException` (KHÔNG ném lỗi thô); format sai → `BadRequestException INVALID_PLATE` (KHÔNG gọi save); admin path → `register(body.user_id, dto)`.
- **controller** (mock service + mock guard): user route → gọi `register` với `@CurrentUser().userId` (KHÔNG body user_id); admin route → gọi `register` với `dto.user_id`; assert guard wiring admin route có `PermissionsGuard` + metadata `@RequirePermissions('anpr.vehicle.admin_register')` (Reflect metadata); envelope 201 shape.
- Coverage **≥80%** service + util mới.

## 8. Gate (STOP, KHÔNG commit)
- build=0; eslint touched (util/dto/service/controller/module + specs) baseline-proof **0 rule mới**, file mới 0; `npx jest src/modules/anpr` xanh; coverage ≥80% service+util; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies — AnprModule import AuthModule resolve). **KHÔNG live, KHÔNG DB.**
- **Owed (ghi, KHÔNG chạy)**: seed permission `anpr.vehicle.admin_register` + gán role admin (nếu thiếu → admin route 403) · live smoke 2 route khi có DB · UC4 phải gọi `normalizePlate` (đồng bộ).

## 9. Kỷ luật
- **No-migration** (bảng đã có — Setup-0). **ARCH-02** normalize ở util chung (UC4 reuse), KHÔNG nhúng service. **VAL-02** conflict 409 sạch, KHÔNG lộ `23505`/stack. **SEC-01** user route `user_id` từ JWT (KHÔNG body); admin route gate THẬT (PermissionsGuard), tách DTO có `user_id`. **DATA-01** ghi `plate_raw`+`plate_number`+`status='active'`, uniqueness `deleted_at IS NULL`.
- Mirror repo: envelope trả tay inline · validation per-route `@UsePipes` · `@InjectRepository` · conflict pre-check + throw. KHÔNG tự dựng RBAC (owed seed permission).

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan → sang tasks. KHÔNG code.
