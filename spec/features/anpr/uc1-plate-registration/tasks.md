# VPR-001 — tasks.md (UC1 ANPR: đăng ký biển số xe)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo tasks VPR-001: T0 verify → T1 util normalizePlate → T2 DTO×2+mapper → T3 service → T4 controller 2 route → T5 wiring → T-GATE. Mỗi task 1 AC, code/test tách. No-migration, owed seed permission. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. No-migration (bảng Setup-0). KHÔNG seed RBAC (owed).

## Thứ tự
T0 → T1 → T1b → T2 → T3 → T3b → T4 → T4b → T5 → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận đọc CODE THẬT: `@CurrentUser()` path `../../auth/decorators/current-user.decorator.js` (trả `{userId}`); `PermissionsGuard` + `@RequirePermissions` import được từ `../../auth/guards/permissions.guard.js` + `../../auth/decorators/require-permissions.decorator.js`; `AuthModule` export `PermissionsGuard` + `AuthzReadRepository`; `IsNull` import từ `typeorm`; field entity khớp (`userId`/`plateNumber`/`plateRaw`/`vehicleType`/`note`/`status`/`deletedAt`).
- **AC**: dán xác nhận 5 mục; thiếu/không import được mục nào → **DỪNG báo Thiếu Chủ** (không bịa path).

## T1 — Util `normalizePlate` (code) — plan §2, OQ-2, ARCH-02
- `src/modules/anpr/utils/normalize-plate.ts`: `export function normalizePlate(raw: string): string` = `String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, '')`. Pure function (KHÔNG phụ thuộc Nest), export để UC4 dùng. Comment **bắt buộc**: "KHÔNG map nhầm-lẫn O/0,I/1 — xử OCR ở UC4".
- **AC**: `normalizePlate('30A-123.45')==='30A12345'`; chỉ trim→upper→strip `[^A-Z0-9]`; KHÔNG có logic map O/0,I/1; comment có mặt.

## T1b — Util test — OQ-2
- `normalize-plate.spec.ts`: `"30A-123.45"→"30A12345"`, lowercase→upper, strip space/`-`/`.`/`,`/ký tự lạ; `"o0i1"→"O0I1"` (chứng minh KHÔNG map O→0/I→1).
- **AC**: các ca xanh, đặc biệt ca `O/0,I/1` giữ nguyên ký tự.

## T2 — DTO ×2 + response mapper (code) — plan §3/§6, OQ-1/5
- `dto/create-vehicle-registration.dto.ts` (user): `plate_raw`(`@Expose('plate_raw') @IsString @IsNotEmpty @MaxLength(20)`), `vehicle_type?`(`@IsOptional @IsString @MaxLength(50)`), `note?`(`@IsOptional @IsString @MaxLength(255)`). **KHÔNG** field `user_id`.
- `dto/admin-create-vehicle-registration.dto.ts` (admin): các field trên + `user_id`(`@Expose('user_id') @IsUUID` required).
- `dto/vehicle-registration-response.dto.ts`: `toVehicleRegistrationResponse(entity)` (mirror `toIotDeviceResponse`) — chỉ field công khai.
- **AC**: user DTO KHÔNG có `user_id`; admin DTO có `user_id` required (`@IsUUID`); mapper trả shape công khai (không lộ field nội bộ).

## T3 — Service `VehicleRegistrationService.register` (code) — plan §4, OQ-3/4, VAL-02
- `services/vehicle-registration.service.ts`, inject `@InjectRepository(VehicleRegistrationEntity)`. `register(userId, dto)`:
  1. `plateNumber = normalizePlate(dto.plate_raw)`.
  2. Validate (trên đã-normalize): `^[0-9A-Z]+$` && length 6–10 && ≥1 `[A-Z]` && ≥1 `[0-9]` → fail → `BadRequestException({code:'INVALID_PLATE'})`.
  3. Pre-check `findOne({where:{plateNumber, deletedAt: IsNull()}})` tồn tại → `ConflictException({code:'PLATE_ALREADY_REGISTERED', message:'Biển số này đã được đăng ký'})` (KHÔNG kèm user giữ biển).
  4. `save({userId, plateRaw: dto.plate_raw, plateNumber, vehicleType, note, status:'active'})`.
  5. `catch` DB `23505` → ném lại `ConflictException PLATE_ALREADY_REGISTERED` (KHÔNG để 23505 phọt client).
- **AC**: ok → `save` gọi với `plateNumber` chuẩn + `status:'active'` + `userId` truyền vào; trùng/23505 → 409 `PLATE_ALREADY_REGISTERED`; format sai → 400 `INVALID_PLATE` (KHÔNG `save`).

## T3b — Service test (mock repo) — OQ-3/4, VAL-02
- ok (lưu đúng field + status active + userId); pre-check trùng (findOne trả row) → ConflictException; `save` ném `{code:'23505'}` → safety-net ConflictException (KHÔNG ném thô); format sai (5 ký tự / 11 / toàn chữ / toàn số) → BadRequestException, KHÔNG gọi `save`; message conflict KHÔNG chứa thông tin user khác.
- **AC**: 4 nhánh xanh; coverage service ≥80% (gộp T-GATE).

## T4 — Controller 2 route (code) — plan §5, OQ-1, SEC-01
- `controllers/vehicle-registration.controller.ts`:
  - **User**: `@Controller('anpr/vehicle-registrations')` `@Post()` `@UseGuards(JwtAuthGuard)` `@UsePipes(ValidationPipe{whitelist:true,transform:true})` → `register(@CurrentUser() u, @Body() CreateVehicleRegistrationDto)` → `service.register(u.userId, dto)`.
  - **Admin**: route `anpr/admin/vehicle-registrations` `@Post()` `@UseGuards(JwtAuthGuard, PermissionsGuard)` `@RequirePermissions('anpr.vehicle.admin_register')` → `@Body() AdminCreateVehicleRegistrationDto` → `service.register(dto.user_id, dto)`.
  - Cả 2: `@HttpCode(201)`, trả `{success:true, message:'Vehicle registered successfully', data: toVehicleRegistrationResponse(entity)}`.
- **AC**: user route lấy `userId` từ `@CurrentUser()` (KHÔNG body); admin route lấy `user_id` từ body + có `PermissionsGuard`+`@RequirePermissions('anpr.vehicle.admin_register')`; cả 2 CÙNG mapper + CÙNG envelope 201.

## T4b — Controller test (mock service + mock guard) — OQ-1, SEC-01
- user route → `service.register` gọi với `@CurrentUser().userId`, body whitelist loại `user_id` thừa; admin route → `register` với `dto.user_id`; assert metadata `@RequirePermissions` = `['anpr.vehicle.admin_register']` + guard list admin route chứa `PermissionsGuard`; envelope 201 + cùng shape mapper.
- **AC**: các assert xanh; chứng minh route user KHÔNG dùng body user_id.

## T5 — Wiring `anpr.module.ts` (code) — plan §5
- `imports: [TypeOrmModule.forFeature([VehicleRegistrationEntity]), AuthModule]`; `controllers: [VehicleRegistrationController]`; `providers: [VehicleRegistrationService]`; giữ `exports: [TypeOrmModule]`.
- **AC**: AppModule compile, 0 circular/UnknownDependencies; PermissionsGuard/AuthzReadRepository resolve qua AuthModule.

## T-GATE — (STOP, KHÔNG commit) — plan §8
- build=0; eslint touched (util/dto/mapper/service/controller/module + specs) baseline-proof **0 rule mới**, file mới 0; `npx jest src/modules/anpr` xanh; coverage **≥80%** service + util mới; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies); throwaway xóa. **KHÔNG live, KHÔNG DB, KHÔNG commit.**
- **Owed (ghi, KHÔNG chạy)**: seed permission `anpr.vehicle.admin_register` + gán role admin (thiếu → admin route 403 mọi người) · live smoke 2 route khi có DB · **UC4 phải gọi `normalizePlate`** (đồng bộ chuẩn hóa).
- **AC**: bảng gate đầy đủ + báo cáo: 2 DTO tách (user không user_id) ✓ · admin gate THẬT ✓ · normalize không map O/0,I/1 ✓ · conflict sạch không lộ 23505 ✓ · format validate ✓ · cùng shape 2 route ✓ · no-migration ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC1
- T0 → verify imports/paths trước khi code
- T1/T1b → util `normalizePlate` (CRUX, dùng chung UC4)
- T2 → 2 DTO tách + response mapper
- T3/T3b → service `register` (normalize→validate→pre-check 409→23505 safety-net)
- T4/T4b → controller 2 route (user JWT / admin real-gate), cùng envelope
- T5 → wiring AnprModule (import AuthModule + controller + provider)
- T-GATE → gate + STOP + Owed (seed permission admin · UC4 đồng bộ · live smoke)
