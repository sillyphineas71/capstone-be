# PLAN — UC-61: Đăng ký thiết bị họp mới (Register new meeting equipment)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới plan.md cho UC-61 (kế hoạch triển khai, mirror module `rooms`). | Toàn bộ file |

> Dựa trên `spec.md` (UC-61) đã duyệt. **CHỈ kế hoạch** — KHÔNG code, KHÔNG task breakdown.
> Phạm vi: chỉ create thiết bị. KHÔNG UC-62..65. KHÔNG migration, KHÔNG execute seed.
> Các quyết định C1–C8 trong spec đã được chốt (§0.2) — plan này KHÔNG mở lại.

---

## 0. Ràng buộc & quyết định đã chốt (không mở lại)

### 0.1. Bối cảnh
- Module `equipment` = **STUB** (`entities/equipment.entity.ts` + `equipment.module.ts` chỉ `TypeOrmModule.forFeature([EquipmentEntity])` + import `AccountsModule`, `RoomsModule`). Không controller/service/dto.
- UC-61 là **UC đầu module** ⇒ thiết lập nền `EquipmentController` + `EquipmentService`.
- Bảng `equipments` **ĐÃ tồn tại trong DB** ⇒ **KHÔNG migration**.
- **Mirror module `rooms`** (đã xác nhận pattern thật).

### 0.2. Quyết định chốt (từ spec, C1–C8)
| # | Chốt |
| :--- | :--- |
| 1 | Endpoint `POST /api/v1/equipments`, 201, `JwtAuthGuard`+`PermissionsGuard`+`@RequirePermissions('equipment.create')`, `ValidationPipe(whitelist+forbidNonWhitelisted+transform)`, response `{success,message,data:EquipmentResponseDto}`. |
| 2 | `equipmentCode` **bắt buộc**, format `^[A-Z0-9]+(?:-[A-Z0-9]+)*$`, normalize uppercase+trim. |
| 3 | Input: `equipmentName`(bắt buộc ≤150), `equipmentType`(bắt buộc `@IsEnum`), `equipmentCode`(bắt buộc), `serialNumber?`/`brand?`/`model?`/`purchaseDate?`/`specification?`/`healthStatus?`. KHÔNG nhận `currentRoomId/iotDeviceId/assetStatus/assign*/lastIssue*/lastMaintenance*`. |
| 4 | Khởi tạo: `assetStatus='available'` (server cứng), `healthStatus = dto.healthStatus ?? 'unknown'`, `currentRoomId=null`, assign/maintenance/issue = null. |
| 5 | Uniqueness app-level (`withDeleted:true`): `serialNumber` (chỉ khi có) → 409 `EQUIPMENT_SERIAL_ALREADY_EXISTS`; `equipmentCode` → 409 `EQUIPMENT_CODE_ALREADY_EXISTS`. |
| 6 | Tạo entity TRONG transaction; audit NGOÀI transaction (fail-separate): `actionType='create'`, `entityType='equipment'`, `newValueJson={equipmentCode,equipmentName,equipmentType,serialNumber,assetStatus,healthStatus}`, `severity=INFO`, `ipAddress` từ `@Ip()`. |
| 7 | Permission mới `equipment.create` (`module_code='equipment'`, `action_code='create'`) → `[SYSTEM_ADMIN,BUSINESS_ADMIN]`; seed mirror `SeedCameraDomainRbacPermissions`/`SeedIotDeviceReadPermission`, KHÔNG execute. |
| 8 | KHÔNG migration, KHÔNG mutation ngoài create, KHÔNG UC-62..65. |

---

## 1. Kiến trúc & luồng

```
POST /api/v1/equipments
  → EquipmentController.create (MỚI)
      JwtAuthGuard → PermissionsGuard('equipment.create') → ValidationPipe(CreateEquipmentDto)
      @CurrentUser() userId, @Ip() ipAddress
  → EquipmentService.create(dto, userId, ipAddress) (MỚI)
      1. normalize (equipmentCode uppercase+trim, equipmentName trim)
      2. checkDuplicateSerial(serialNumber)   // chỉ khi có giá trị
      3. checkDuplicateCode(equipmentCode)
      4. dataSource.transaction(em => em.save(EquipmentEntity, {...trạng thái khởi tạo}))
      5. audit fail-separate (transaction riêng, try/catch, không rollback)
      6. map → EquipmentResponseDto
  → 201 { success, message, data }
```

### 1.1. Mirror rooms (trỏ file/method thật)
| Thành phần UC-61 | Mirror từ rooms |
| :--- | :--- |
| `EquipmentController.create` | `RoomsController.create` — `src/modules/rooms/controllers/rooms.controller.ts:44-80` (`@Post()`, `@HttpCode(201)`, `@UseGuards(PermissionsGuard)`, `@RequirePermissions('room.create')`, `@UsePipes(ValidationPipe)`, `@CurrentUser()`, `@Ip()`, `@Req()`). |
| `EquipmentService.create` | `RoomsService.create` — `src/modules/rooms/services/rooms.service.ts:73-145`. |
| `checkDuplicate*` | `RoomsService.checkDuplicateRoomCode` (`:25-42`) + `checkDuplicateRoomName` (`:47-66`) — dùng `findOne({ withDeleted:true })` + `ConflictException` payload chuẩn. |
| Transaction tạo + audit fail-separate | `RoomsService.create` `:87-134` — tạo trong `dataSource.transaction`; audit trong transaction riêng bọc `try/catch`, log `logger.error` nếu fail (FR-019). |
| `EquipmentResponseDto` | `CreateRoomResponseDto` — `src/modules/rooms/dto/create-room-response.dto.ts` (plain class + `constructor(data){Object.assign(this,data)}`). |
| `CreateEquipmentDto` | `CreateRoomDto` — `src/modules/rooms/dto/create-room.dto.ts` (class-validator decorators; `roomCode` `@Matches` mirror cho `equipmentCode`). |
| Seed permission | mục `room.create` trong `src/database/seeds/20260704000002-SeedCameraDomainRbacPermissions.ts:148-155` + khung `SeedIotDeviceReadPermission.ts` (queryRunner + `ON CONFLICT DO NOTHING`). |

---

## 2. Danh sách file TẠO / SỬA

### 2.1. TẠO mới
| File | Vai trò |
| :--- | :--- |
| `src/modules/equipment/controllers/equipment.controller.ts` | `EquipmentController` — endpoint `POST /equipments`. |
| `src/modules/equipment/services/equipment.service.ts` | `EquipmentService` — business logic create + uniqueness + audit. |
| `src/modules/equipment/dto/create-equipment.dto.ts` | `CreateEquipmentDto` — input validate. |
| `src/modules/equipment/dto/equipment-response.dto.ts` | `EquipmentResponseDto` — shape response. |
| `src/database/seeds/2026XXXXXXXXXX-SeedEquipmentCreatePermission.ts` | Seed permission `equipment.create` (KHÔNG execute). |
| `src/modules/equipment/tests/equipment.service.spec.ts` | Unit test service. |
| `src/modules/equipment/tests/equipment.controller.spec.ts` | Unit test controller (RBAC + response shape). |

### 2.2. SỬA (additive) — chỉ 1 file
| File | Thay đổi |
| :--- | :--- |
| `src/modules/equipment/equipment.module.ts` | THÊM `import AuthModule` (guards DI); THÊM `controllers:[EquipmentController]`, `providers:[EquipmentService]`; giữ nguyên `AccountsModule`, `RoomsModule`, `TypeOrmModule.forFeature([EquipmentEntity])`, `exports:[TypeOrmModule]`. |

> KHÔNG tạo `entities/equipment.entity.ts` (đã có). KHÔNG migration.

---

## 3. Thiết kế `EquipmentService.create()`

### 3.1. Chữ ký
```
create(dto: CreateEquipmentDto, userId: string, ipAddress?: string): Promise<EquipmentResponseDto>
```

### 3.2. Constructor (mirror RoomsService)
- `@InjectRepository(EquipmentEntity) private readonly equipmentRepo: Repository<EquipmentEntity>`
- `private readonly dataSource: DataSource`
- `private readonly logger = new Logger(EquipmentService.name)`
- `AuditLogEntity` KHÔNG cần `forFeature` — dùng `em.create/save(AuditLogEntity,...)` trong transaction qua `DataSource` (metadata toàn cục nhờ `AdministrationModule` `@Global`; đúng cách `RoomsService` đang làm).

### 3.3. Các bước
1. **Normalize**: `equipmentCode = dto.equipmentCode.toUpperCase().trim()`; `equipmentName = dto.equipmentName.trim()`.
2. **checkDuplicateSerial**: nếu `dto.serialNumber` có giá trị (sau trim ≠ rỗng) → `equipmentRepo.findOne({ where:{ serialNumber }, withDeleted:true })`; tồn tại → `ConflictException` code `EQUIPMENT_SERIAL_ALREADY_EXISTS`. (Bỏ qua nếu serial null — nhiều thiết bị được phép null serial.)
3. **checkDuplicateCode**: `findOne({ where:{ equipmentCode }, withDeleted:true })`; tồn tại → `ConflictException` code `EQUIPMENT_CODE_ALREADY_EXISTS`.
4. **Transaction tạo**:
   ```
   const saved = await dataSource.transaction(em => {
     const eq = em.create(EquipmentEntity, {
       equipmentCode, equipmentName,
       equipmentType: dto.equipmentType,
       serialNumber: dto.serialNumber ?? null,
       brand: dto.brand ?? null,
       model: dto.model ?? null,
       purchaseDate: dto.purchaseDate ?? null,
       specificationJson: dto.specification ?? null,
       assetStatus: AssetStatus.AVAILABLE,          // server set cứng
       healthStatus: dto.healthStatus ?? HealthStatus.UNKNOWN,
       currentRoomId: null,
       assignedBy: null, assignedAt: null, installedAt: null, assignmentNote: null,
       iotDeviceId: null,
       lastMaintenanceAt: null, lastIssueReportedAt: null, lastIssueNote: null,
     });
     return em.save(EquipmentEntity, eq);
   });
   ```
5. **Audit fail-separate** (transaction riêng, `try/catch`, `logger.error` khi fail, KHÔNG rollback `saved`):
   `em.save(AuditLogEntity, { userId, actionType:'create', entityType:'equipment', entityId:saved.id, newValueJson:{equipmentCode,equipmentName,equipmentType,serialNumber,assetStatus,healthStatus}, ipAddress: ipAddress ?? null, severity: AuditLogSeverity.INFO })`.
6. **Map** → `new EquipmentResponseDto({...})`.

### 3.4. Private helper
- `private async checkDuplicateSerial(serial: string): Promise<void>`
- `private async checkDuplicateCode(code: string): Promise<void>`
(Mirror `checkDuplicateRoomCode/Name`; payload `ConflictException` theo §5.)

---

## 4. DTO

### 4.1. `CreateEquipmentDto`
| Field | Decorators |
| :--- | :--- |
| `equipmentName` | `@IsString`, `@IsNotEmpty`, `@MaxLength(150)` |
| `equipmentType` | `@IsEnum(EquipmentType)` (import từ `../entities/equipment.entity.js`) |
| `equipmentCode` | `@IsString`, `@IsNotEmpty`, `@Length(3,80)`, `@Matches(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/)`, `@MaxLength(80)` |
| `serialNumber?` | `@IsOptional`, `@IsString`, `@MaxLength(120)` |
| `brand?` | `@IsOptional`, `@IsString`, `@MaxLength(100)` |
| `model?` | `@IsOptional`, `@IsString`, `@MaxLength(100)` |
| `purchaseDate?` | `@IsOptional`, `@IsDateString` + validate không tương lai (custom check hoặc so `new Date()` ở service; đề xuất kiểm ở service để tránh phụ thuộc thời gian trong DTO) |
| `specification?` | `@IsOptional`, `@IsObject` (map `specification_json`) |
| `healthStatus?` | `@IsOptional`, `@IsEnum(HealthStatus)` |

> `forbidNonWhitelisted:true` sẽ **reject** nếu client gửi field cấm (`currentRoomId/iotDeviceId/assetStatus/assignedBy/...`) → 400. `whitelist:true` loại field lạ. (Không cần khai các field cấm trong DTO.)

### 4.2. `EquipmentResponseDto`
Plain class + `constructor(data){Object.assign(this,data)}` (mirror `CreateRoomResponseDto`). Field trả:
`id, equipmentCode, equipmentName, equipmentType, serialNumber, brand, model, purchaseDate, assetStatus, healthStatus, currentRoomId, createdAt`.
(Không trả field nhạy cảm/không cần: `deletedAt`, `specificationJson` tùy chọn — đề xuất trả gọn như trên; có thể thêm `specificationJson` nếu team muốn.)

---

## 5. Error handling map

| Tình huống | Exception | HTTP | `error.code` |
| :--- | :--- | :--- | :--- |
| Thiếu/sai field DTO | `ValidationPipe` | 400 | (validation messages) |
| `equipmentType`/`healthStatus` ngoài enum | `ValidationPipe` | 400/422 | (enum message) |
| Gửi field cấm (forbidNonWhitelisted) | `ValidationPipe` | 400 | — |
| Serial trùng | `ConflictException` | 409 | `EQUIPMENT_SERIAL_ALREADY_EXISTS` |
| equipment_code trùng | `ConflictException` | 409 | `EQUIPMENT_CODE_ALREADY_EXISTS` |
| Chưa đăng nhập | `JwtAuthGuard` | 401 | — |
| Thiếu quyền | `PermissionsGuard` | 403 | — |

Payload `ConflictException` theo exception filter chuẩn dự án:
```
{ success:false, message:'...', error:{ code, details }, timestamp:new Date().toISOString(), path:'/api/v1/equipments' }
```
(mirror `RoomsService` `:31-40`).

---

## 6. Audit plan
- 1 dòng `audit_logs` mỗi lần create thành công.
- Ghi **ngoài** transaction tạo thiết bị (transaction riêng) — audit fail chỉ `logger.error`, KHÔNG rollback thiết bị (mirror FR-019 rooms).
- KHÔNG log secret; `newValueJson` chỉ chứa field mô tả tài sản (không token/password).
- `AuditLogEntity` + `AuditLogSeverity` import từ `../../administration/entities/audit-log.entity.js` (đúng path rooms dùng).

---

## 7. RBAC + Seed

### 7.1. Permission `equipment.create`
| Thuộc tính | Giá trị |
| :--- | :--- |
| `permission_code` | `equipment.create` |
| `permission_name` | `Đăng ký thiết bị họp mới` |
| `module_code` | `equipment` |
| `action_code` | `create` |
| `description` | `Cho phép đăng ký (tạo mới) thiết bị họp vào kho.` |
| roles | `['SYSTEM_ADMIN','BUSINESS_ADMIN']` (mirror `room.create`) |

### 7.2. Seed file
- Bám `SeedIotDeviceReadPermission` (`queryRunner.startTransaction`, `INSERT ... ON CONFLICT (permission_code) DO NOTHING RETURNING id`, loop role → `SELECT id FROM roles WHERE role_code=$1 AND is_active=true`, `INSERT role_permissions ... ON CONFLICT DO NOTHING`).
- Idempotent; **KHÔNG execute**, **KHÔNG wire runner** (ghi chú NC giống các seed hiện có: dự án chưa có seed-runner — vấn đề team-wide, ngoài scope UC-61).

---

## 8. Module wiring — `EquipmentModule`

### 8.1. Thay đổi (additive)
```
imports: [
  AccountsModule,      // giữ nguyên
  RoomsModule,         // giữ nguyên
  AuthModule,          // THÊM — cung cấp DI cho JwtAuthGuard + PermissionsGuard
  TypeOrmModule.forFeature([EquipmentEntity]),  // giữ nguyên
],
controllers: [EquipmentController],   // THÊM
providers: [EquipmentService],        // THÊM
exports: [TypeOrmModule],             // giữ nguyên
```

### 8.2. Xác minh DI đủ cho guards
- `JwtAuthGuard` cần `JwtService, AuthConfigService, RedisService, Reflector` → do **`AuthModule`** cung cấp (rooms/live-meeting đều import `AuthModule`). **`equipment.module` hiện CHƯA import `AuthModule`** ⇒ **bắt buộc thêm** (điểm quan trọng, dễ sót).
- `PermissionsGuard` cần `Reflector, AuthzReadRepository` → `AuthzReadRepository` export từ `AuthModule`.
- `AuditLogEntity` (audit) không cần `forFeature`: `AdministrationModule` là `@Global` ⇒ metadata sẵn cho `DataSource.transaction(em => em.save(AuditLogEntity,...))` (đúng cách rooms/live-meeting làm; live-meeting.module comment xác nhận "AdministrationModule là @Global").
- `EquipmentEntity` repo: đã có qua `TypeOrmModule.forFeature([EquipmentEntity])`.
- `DataSource`: inject trực tiếp (global TypeORM), không cần khai thêm.

> Nếu khi build phát sinh lỗi DI Reflector/guard, kiểm lại việc import `AuthModule` (và `JwtModule.register({})` nếu guard yêu cầu trực tiếp — rooms có thêm `JwtModule.register({})`; xác minh runtime, thêm nếu cần, vẫn additive).

---

## 9. Test plan (liệt kê — implement ở bước sau)

### 9.1. Service (`equipment.service.spec.ts`)
- **S1**: create hợp lệ → `assetStatus='available'`, `healthStatus='unknown'` (khi DTO không set), trả id UUID.
- **S2**: `healthStatus='healthy'` trong DTO → lưu `healthy` (optional override).
- **S3**: serial trùng (có giá trị) → `ConflictException` `EQUIPMENT_SERIAL_ALREADY_EXISTS`.
- **S4**: `equipmentCode` trùng → `ConflictException` `EQUIPMENT_CODE_ALREADY_EXISTS`.
- **S5**: serial null → KHÔNG check trùng serial (bỏ qua), create OK.
- **S6**: normalize `equipmentCode` uppercase+trim trước khi lưu/check.
- **S7**: audit ghi đúng 1 dòng (`entityType='equipment'`, `entityId`), và audit fail KHÔNG throw (fail-separate) — mock em.save(AuditLog) reject → create vẫn resolve.
- **S8**: field cấm không được set (nếu lọt vào dto vẫn không map — service chỉ đọc field cho phép).

### 9.2. Controller (`equipment.controller.spec.ts`)
- **C1**: gọi service đúng `(dto,userId,ip)`, trả `{success,message,data}`.
- **C2**: metadata guard = `[JwtAuthGuard, PermissionsGuard]`.
- **C3**: `@RequirePermissions` = `['equipment.create']`.
- **C4**: (tùy chọn) status 201 metadata.

> Test bám kỹ thuật spec live-meeting/rooms hiện có: instantiate service với mock `Repository` + `DataSource` (mock `transaction` gọi callback với fake `em`); controller dùng `Test.createTestingModule` + `overrideGuard`. Ưu tiên static import, tránh dynamic import (jest CJS).

---

## 10. Rủi ro & xác minh

| Rủi ro | Xác minh / xử lý |
| :--- | :--- |
| Guards không resolve DI (thiếu `AuthModule`) | Thêm `AuthModule` vào imports (§8). Đối chiếu `rooms.module.ts:41` + `live-meeting.module.ts:20`. |
| `AuditLogEntity` không tìm thấy metadata | Không cần forFeature — `AdministrationModule` `@Global`; xác minh bằng cách chạy tạo thử/đọc RoomsService (đang chạy tốt với cùng cơ chế). |
| `DataSource.transaction` mock trong test | Mirror cách test service khác mock `transaction(cb)` → gọi `cb(fakeEm)`. |
| Enum import path sai | Import `EquipmentType/AssetStatus/HealthStatus` từ `../entities/equipment.entity.js` (đúng path entity thật). |
| `purchaseDate` tương lai | Kiểm ở service (so `new Date()`), tránh phụ thuộc thời gian trong DTO decorator. |
| Race-condition check-then-insert | Chấp nhận app-level (mirror rooms); unique index DB là follow-up cần migration — ngoài scope UC-61. |
| Bảng `equipments` chưa có trong DB thật | Theo bối cảnh đã xác nhận bảng tồn tại ⇒ không migration. Nếu build/run báo thiếu bảng → là việc nền ngoài UC-61, dừng và báo. |

---

## 11. Tác động code người khác

- **KHÔNG sửa** `rooms/`, `accounts/`, `iot/`, `auth/`, `administration/` — chỉ **ĐỌC** làm tham chiếu pattern.
- **SỬA duy nhất** `src/modules/equipment/equipment.module.ts` — **additive** (thêm `AuthModule` import + `controllers` + `providers`), giữ nguyên `AccountsModule/RoomsModule/forFeature/exports` sẵn có.
- Toàn bộ phần còn lại là **file tạo mới** trong `src/modules/equipment/` + 1 seed mới trong `src/database/seeds/`.
- KHÔNG migration, KHÔNG execute seed, KHÔNG đụng entity `equipment.entity.ts`.

---

## 12. Checklist file cần tạo/sửa

**TẠO**
- [ ] `src/modules/equipment/dto/create-equipment.dto.ts`
- [ ] `src/modules/equipment/dto/equipment-response.dto.ts`
- [ ] `src/modules/equipment/services/equipment.service.ts`
- [ ] `src/modules/equipment/controllers/equipment.controller.ts`
- [ ] `src/database/seeds/2026XXXXXXXXXX-SeedEquipmentCreatePermission.ts` (KHÔNG execute)
- [ ] `src/modules/equipment/tests/equipment.service.spec.ts`
- [ ] `src/modules/equipment/tests/equipment.controller.spec.ts`

**SỬA (additive)**
- [ ] `src/modules/equipment/equipment.module.ts` (thêm `AuthModule` + `controllers` + `providers`)

**KHÔNG làm**: migration; execute/wire seed-runner; sửa module khác; mutation ngoài create; UC-62..65.
