# TASKS — UC-61: Đăng ký thiết bị họp mới (Register new meeting equipment)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới tasks.md cho UC-61 (T001–T012). | Toàn bộ file |

> Dựa trên `spec.md` + `plan.md` (UC-61) đã duyệt. **CHỈ danh sách task** — KHÔNG code.
> Phạm vi: chỉ create thiết bị. KHÔNG UC-62..65. KHÔNG migration, KHÔNG execute seed, KHÔNG commit.
> Mirror module `rooms` (trỏ file/method như plan §1.1).

---

## 0. Ràng buộc thực thi (áp cho mọi task)

- **8 ràng buộc chốt** (spec §0.2 / plan §0.2): endpoint + guard + DTO + trạng thái khởi tạo + uniqueness + transaction/audit + permission + purchaseDate không tương lai. KHÔNG mở lại.
- **Bảo vệ code người khác**: chỉ **ĐỌC** `rooms/accounts/iot/auth/administration` làm tham chiếu. **SỬA additive duy nhất** `equipment.module.ts`. KHÔNG đụng `equipment.entity.ts`. KHÔNG migration, KHÔNG execute seed, KHÔNG commit.
- **Enum/entity import**: `EquipmentType/AssetStatus/HealthStatus` + `EquipmentEntity` từ `../entities/equipment.entity.js`. `AuditLogEntity/AuditLogSeverity` từ `../../administration/entities/audit-log.entity.js`.
- Ưu tiên **static import** (jest CJS không chạy dynamic import).

---

## T001 — [CREATE] `CreateEquipmentDto`
**File**: `src/modules/equipment/dto/create-equipment.dto.ts`
**Mirror**: `src/modules/rooms/dto/create-room.dto.ts`.

Nội dung:
- `equipmentName`: `@IsString`, `@IsNotEmpty`, `@MaxLength(150)`.
- `equipmentType`: `@IsEnum(EquipmentType)` (message liệt kê giá trị hợp lệ).
- `equipmentCode`: `@IsString`, `@IsNotEmpty`, `@Length(3,80)`, `@Matches(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/)`, `@MaxLength(80)`.
- `serialNumber?`: `@IsOptional`, `@IsString`, `@MaxLength(120)`.
- `brand?`: `@IsOptional`, `@IsString`, `@MaxLength(100)`.
- `model?`: `@IsOptional`, `@IsString`, `@MaxLength(100)`.
- `purchaseDate?`: `@IsOptional`, `@IsDateString` (kiểm "không tương lai" ở service — T003, tránh phụ thuộc thời gian trong decorator).
- `specification?`: `@IsOptional`, `@IsObject` (→ `specification_json`).
- `healthStatus?`: `@IsOptional`, `@IsEnum(HealthStatus)`.
- KHÔNG khai field cấm (`currentRoomId/iotDeviceId/assetStatus/assignedBy/assignedAt/installedAt/assignmentNote/lastIssue*/lastMaintenance*`) → `forbidNonWhitelisted` sẽ reject nếu client gửi.

**DoD**: file biên dịch tsc sạch; import enum đúng path `.js`; không field ngoài danh sách chốt (ràng buộc 3).

---

## T002 — [CREATE] `EquipmentResponseDto`
**File**: `src/modules/equipment/dto/equipment-response.dto.ts`
**Mirror**: `src/modules/rooms/dto/create-room-response.dto.ts` (plain class + `constructor(data){Object.assign(this,data)}`).

Field trả: `id, equipmentCode, equipmentName, equipmentType, serialNumber, brand, model, purchaseDate, assetStatus, healthStatus, currentRoomId, createdAt`.

**DoD**: plain class, không decorator validate; có constructor `Object.assign`; không lộ `deletedAt`/field nhạy cảm.

---

## T003 — [CREATE] `EquipmentService` (business logic create)
**File**: `src/modules/equipment/services/equipment.service.ts`
**Mirror**: `src/modules/rooms/services/rooms.service.ts:73-145` (+ `checkDuplicate*` `:25-66`).

Constructor: `@InjectRepository(EquipmentEntity) equipmentRepo: Repository<EquipmentEntity>`, `dataSource: DataSource`, `logger = new Logger(EquipmentService.name)`.

`create(dto: CreateEquipmentDto, userId: string, ipAddress?: string): Promise<EquipmentResponseDto>` — trình tự:
1. **Normalize**: `equipmentCode = dto.equipmentCode.toUpperCase().trim()`; `equipmentName = dto.equipmentName.trim()`.
2. **purchaseDate không tương lai**: nếu `dto.purchaseDate` có và `> hôm nay` → `BadRequestException`/`UnprocessableEntityException` code `INVALID_PURCHASE_DATE` (ràng buộc 8).
3. **checkDuplicateSerial** (private): chỉ khi `dto.serialNumber` có giá trị (trim ≠ rỗng) → `findOne({ where:{serialNumber}, withDeleted:true })`; tồn tại → `ConflictException` `EQUIPMENT_SERIAL_ALREADY_EXISTS`.
4. **checkDuplicateCode** (private): `findOne({ where:{equipmentCode}, withDeleted:true })`; tồn tại → `ConflictException` `EQUIPMENT_CODE_ALREADY_EXISTS`.
5. **Transaction tạo** (`dataSource.transaction`): `em.save(EquipmentEntity,{...})` với `assetStatus=AssetStatus.AVAILABLE` (server cứng), `healthStatus = dto.healthStatus ?? HealthStatus.UNKNOWN`, `serialNumber/brand/model/purchaseDate/specificationJson` map từ dto (`?? null`), `currentRoomId=null`, `assignedBy/assignedAt/installedAt/assignmentNote=null`, `iotDeviceId=null`, `lastMaintenanceAt/lastIssueReportedAt/lastIssueNote=null`.
6. **Audit fail-separate**: transaction **RIÊNG** bọc `try/catch`; `em.save(AuditLogEntity,{ userId, actionType:'create', entityType:'equipment', entityId:saved.id, newValueJson:{equipmentCode,equipmentName,equipmentType,serialNumber,assetStatus,healthStatus}, ipAddress: ipAddress ?? null, severity: AuditLogSeverity.INFO })`; nếu lỗi → `logger.error(...)`, **KHÔNG rollback** thiết bị (mirror FR-019).
7. **Map** → `new EquipmentResponseDto({...saved})`.

`ConflictException` payload chuẩn (mirror `rooms.service.ts:31-40`): `{ success:false, message, error:{code,details}, timestamp:new Date().toISOString(), path:'/api/v1/equipments' }`.

**DoD**: đúng trình tự 7 bước; audit tách transaction fail-separate; không log secret; enum set cứng `available`; tsc sạch.

---

## T004 — [CREATE] `EquipmentController` (endpoint)
**File**: `src/modules/equipment/controllers/equipment.controller.ts`
**Mirror**: `src/modules/rooms/controllers/rooms.controller.ts:44-80`.

- `@ApiTags('Equipment')`, `@Controller('equipments')`, `@UseGuards(JwtAuthGuard)`, `@ApiBearerAuth()`.
- Handler `create`: `@Post()`, `@HttpCode(HttpStatus.CREATED)`, `@UseGuards(PermissionsGuard)`, `@RequirePermissions('equipment.create')`, `@UsePipes(new ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true }))`.
- Tham số: `@Body() dto: CreateEquipmentDto`, `@CurrentUser() user`, `@Ip() ipAddress`, (tùy) `@Req() req`.
- Lấy `userId = user?.userId`; nếu thiếu → throw (check JwtAuthGuard).
- Gọi `equipmentService.create(dto, userId, ipAddress)`; trả `{ success:true, message:'Dang ky thiet bi thanh cong', data }`.
- `@ApiResponse` cho 201/400/401/403/409/422.

**DoD**: guard + permission + ValidationPipe đúng ràng buộc 1; response shape `{success,message,data}`; tsc sạch.

---

## T005 — [MODIFY additive] `EquipmentModule` wiring ⚠️ (dễ sót — app không boot nếu thiếu)
**File**: `src/modules/equipment/equipment.module.ts`
**Mirror**: `src/modules/rooms/rooms.module.ts:37-78` (imports `AuthModule` + `JwtModule.register({})`).

Thêm (additive):
- `imports`: **THÊM `AuthModule`** (DI cho `JwtAuthGuard`+`PermissionsGuard`: `JwtService, AuthConfigService, RedisService, Reflector, AuthzReadRepository`) **+ `JwtModule.register({})`** (mirror rooms); giữ nguyên `AccountsModule`, `RoomsModule`, `TypeOrmModule.forFeature([EquipmentEntity])`.
- **THÊM** `controllers: [EquipmentController]`.
- **THÊM** `providers: [EquipmentService]`.
- Giữ nguyên `exports: [TypeOrmModule]`.
- `AuditLogEntity` KHÔNG cần `forFeature` (`AdministrationModule` `@Global`).

**DoD**: chỉ thêm dòng, không xóa/sửa dòng cũ; app boot được (DI guard resolve); `import AuthModule`/`JwtModule` đúng path `.js`.

---

## T006 — [CREATE] Seed permission `equipment.create` (KHÔNG execute)
**File**: `src/database/seeds/2026XXXXXXXXXX-SeedEquipmentCreatePermission.ts`
**Mirror**: `src/database/seeds/20260615000003-SeedIotDeviceReadPermission.ts` + mục `room.create` (`20260704000002-SeedCameraDomainRbacPermissions.ts:148-155`).

- Hàm `seedEquipmentCreatePermission(dataSource)`: `queryRunner` + `startTransaction`.
- `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) VALUES ('equipment.create','Đăng ký thiết bị họp mới','equipment','create','Cho phép đăng ký (tạo mới) thiết bị họp vào kho.',true) ON CONFLICT (permission_code) DO NOTHING RETURNING id`.
- Loop `roleCodes = ['SYSTEM_ADMIN','BUSINESS_ADMIN']` → `SELECT id FROM roles WHERE role_code=$1 AND is_active=true` → `INSERT role_permissions (...) ON CONFLICT DO NOTHING`.
- Ghi chú NC: dự án chưa có seed-runner (team-wide, ngoài scope); file **KHÔNG execute**, **KHÔNG wire runner**.

**DoD**: idempotent (`ON CONFLICT DO NOTHING`); role-set đúng ràng buộc 7; KHÔNG chạy.

---

## T007 — [CREATE] Unit test service (S1–S8)
**File**: `src/modules/equipment/tests/equipment.service.spec.ts`

Instantiate `new EquipmentService(mockRepo, mockDataSource)`; mock `dataSource.transaction(cb)` → gọi `cb(fakeEm)` (fake `em.create/save`). Cases:
- **S1**: create hợp lệ (không `healthStatus`) → `assetStatus='available'`, `healthStatus='unknown'`, trả id.
- **S2**: `healthStatus='healthy'` → lưu `healthy` (override).
- **S3**: serial trùng (có giá trị) → `ConflictException` `EQUIPMENT_SERIAL_ALREADY_EXISTS`.
- **S4**: `equipmentCode` trùng → `ConflictException` `EQUIPMENT_CODE_ALREADY_EXISTS`.
- **S5**: `serialNumber` null → KHÔNG gọi check serial (bỏ qua), create OK.
- **S6**: normalize — input `equipmentCode` thường/space → check + lưu uppercase+trim.
- **S7**: audit fail-separate — mock `em.save(AuditLogEntity)` reject → `create` vẫn resolve (không throw), thiết bị không rollback.
- **S8**: field cấm — service chỉ map field cho phép (assetStatus luôn `available` dù dto cố truyền — server cứng).
- (bổ sung) purchaseDate tương lai → lỗi `INVALID_PURCHASE_DATE`.

**DoD**: 8+ cases pass; mock DataSource/Repository; static import; không dynamic import.

---

## T008 — [CREATE] Unit test controller (C1–C4)
**File**: `src/modules/equipment/tests/equipment.controller.spec.ts`

`Test.createTestingModule` với mock `EquipmentService` + `{provide:AuthzReadRepository, useValue:{}}` (nếu DI yêu cầu); `.overrideGuard(JwtAuthGuard).useValue({canActivate:()=>true}).overrideGuard(PermissionsGuard).useValue({canActivate:()=>true})`. Cases:
- **C1**: gọi service đúng `(dto, userId, ip)`, trả `{success,message,data}`.
- **C2**: metadata guard handler = `[JwtAuthGuard, PermissionsGuard]`.
- **C3**: `@RequirePermissions` metadata = `['equipment.create']`.
- **C4**: (tùy) status 201 metadata.

**DoD**: 4 cases pass; overrideGuard tránh DI thật; static import.

---

## T009 — Cổng chất lượng (KHÔNG commit)
Chạy và ghi kết quả, **phân biệt baseline vs mới** bằng `git stash`:
1. `npx tsc --noEmit` — so tổng lỗi baseline (stash) vs sau (mục tiêu net +0 với file production).
2. `npx eslint` trên các file đã tạo/sửa (2 DTO, service, controller, module, seed, 2 test).
3. `npx jest src/modules/equipment` — 2 suite mới pass (S1–S8, C1–C4).
4. `npx jest src/modules/auth/guards` — xác nhận **0 regression** (guard dùng lại, không sửa).
5. `git stash` để lấy baseline `src/modules/equipment` + `src/modules/auth/guards`, so trước/sau → chứng minh 0 regression.

**DoD**: tsc net +0 (production sạch); eslint file đã đụng sạch (hoặc = baseline pattern); jest equipment pass; auth/guards 0 regression; có bằng chứng git-stash. **KHÔNG commit.**

---

## Ma trận phủ ràng buộc

| Ràng buộc | Task |
| :--- | :--- |
| 1 endpoint/guard/ValidationPipe/response | T004, T005 |
| 2 equipmentCode format + normalize | T001, T003 (normalize), T007 (S6) |
| 3 input field | T001, T007 (S8) |
| 4 trạng thái khởi tạo | T003, T007 (S1/S2) |
| 5 uniqueness 409 | T003, T007 (S3/S4/S5) |
| 6 transaction + audit fail-separate | T003, T007 (S7) |
| 7 permission + seed | T006, T008 (C3) |
| 8 purchaseDate không tương lai / không UC-62..65 | T003, T007 |

---

## KHÔNG được làm
- KHÔNG migration; KHÔNG execute/wire seed-runner; KHÔNG commit.
- KHÔNG sửa `rooms/accounts/iot/auth/administration`; KHÔNG đụng `equipment.entity.ts`.
- KHÔNG mutation ngoài create; KHÔNG UC-62 (báo lỗi)/UC-63 (xóa)/UC-64 (tìm kiếm)/UC-65 (phân bổ phòng).
- KHÔNG nhận `currentRoomId/iotDeviceId/assetStatus/assign*/lastIssue*/lastMaintenance*` từ input.

---

## Thứ tự thực thi
`T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009`

> Chưa code — chờ duyệt tasks.
