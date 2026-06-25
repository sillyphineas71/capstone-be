# VPM-001 — UC2 (ANPR): sửa / vô hiệu hóa / xóa-mềm biển đã đăng ký

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo spec VPM-001 (UC2): user tự sửa note/vehicle_type, đổi status active↔disabled, xóa-mềm biển CỦA MÌNH. Crux = ownership (chặn user A đụng biển user B). RECON code thật (UC1 service, ownership precedent, softDelete). OQ chờ chốt. | Toàn bộ |
| 2026-06-24 | Thiếu Chủ CHỐT OQ-1…5: OQ-1=404 fold-ownership (KHÔNG 403, không lộ tồn tại) · OQ-2=status `{active,disabled}` `@IsIn` · OQ-3=tách route `/:id/status` · OQ-4=DELETE trả `{data:null}` · OQ-5=thêm method vào `VehicleRegistrationService` + PATCH rỗng→no-op 200. §7 đánh dấu ĐÃ CHỐT. | §7 |

> **SPEC-ONLY.** Chưa plan/tasks/code. Nền UC1 (VPR-001) đã commit: bảng + entity + `normalizePlate` + `VehicleRegistrationService`. UC2 thêm method (vào service UC1 — OQ-5) + DTO sửa + 3 route. KHÔNG migration, KHÔNG camera/bridge. **CHỈ user tự quản biển của mình** (admin route owed sau).

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Service UC1 để mở rộng ([vehicle-registration.service.ts](../../../../src/modules/anpr/services/vehicle-registration.service.ts))
- `VehicleRegistrationService` inject `@InjectRepository(VehicleRegistrationEntity) repo`. `register(userId, dto)` đã có pattern: normalize → pre-check → `repo.create/save`, conflict qua `ConflictException({code,message})`. ⇒ UC2 thêm method vào **cùng service** (cùng entity/repo) hợp lý (OQ-5).
- Entity ([vehicle-registration.entity.ts](../../../../src/modules/anpr/entities/vehicle-registration.entity.ts)): `userId`, `plateNumber`, `plateRaw`, `vehicleType`(null), `note`(null), `status`(default `'active'`), `@DeleteDateColumn deletedAt` (soft-delete sẵn), partial unique `plate_number WHERE deleted_at IS NULL`.

### 0.2. Ownership precedent ([meetings.service.ts:656-686](../../../../src/modules/meetings/services/meetings.service.ts))
- Mẫu repo: `findOne({where:{id}})` → `!meeting || deletedAt` → **404 `NotFoundException`**; rồi nếu `userId !== organizerId/hostId` → **403 `ForbiddenException`** (`{success:false, message, error:{code,details}}`). ⇒ repo hiện **404-thiếu rồi 403-không-phải-chủ** → **LỘ tồn tại** bản ghi của người khác.
- UC2 (privacy biển) đề xuất **fold ownership vào lookup**: `findOne({where:{id, userId, deletedAt:IsNull()}})` → null → **404 luôn** (giấu tồn tại biển người khác). Khác precedent meetings → đưa OQ-1.

### 0.3. Soft-delete ([media-files.service.ts:140](../../../../src/modules/recording/services/media-files.service.ts))
- `await this.repo.softDelete(fileId)` (TypeORM, set `deletedAt` qua `@DeleteDateColumn`). "Load 1 record chưa xóa mềm; 404 nếu thiếu/đã xóa" ([:144](../../../../src/modules/recording/services/media-files.service.ts)). ⇒ UC2 xóa-mềm dùng `repo.softDelete(id)`; lookup luôn lọc `deletedAt: IsNull()`.

### 0.4. PATCH/DELETE controller + 404 + @CurrentUser
- PATCH/DELETE có tiền lệ ([iot-devices.controller.ts](../../../../src/modules/iot/controllers/iot-devices.controller.ts), [media-files.controller.ts](../../../../src/modules/recording/controllers/media-files.controller.ts)); `:id` qua `ParseUUIDPipe`. `@CurrentUser()` → `{userId}` (UC1 đã dùng). Envelope inline `{success,message,data}` (mirror UC1). 404 = `NotFoundException({code,message,...})`.

---

## 1. Scope (UC2)

### TRONG scope
1. **PATCH `/api/v1/anpr/vehicle-registrations/:id`** — sửa `note` và/hoặc `vehicle_type` (DTO chỉ nhận 2 field này).
2. **PATCH `/api/v1/anpr/vehicle-registrations/:id/status`** — đổi `status` `'active' ↔ 'disabled'` (body `{status}`, validate enum 2 giá trị).
3. **DELETE `/api/v1/anpr/vehicle-registrations/:id`** — xóa-mềm (`repo.softDelete`, set `deletedAt`).
4. **Ownership** (crux): cả 3 route chỉ thao tác trên biển CỦA current user; không thuộc → 404 (OQ-1). Tất cả `JwtAuthGuard`, `userId` từ `@CurrentUser()`.

### NGOÀI scope (UC sau — KHÔNG làm)
- KHÔNG sửa `plate_number`/`plate_raw`/`user_id` (đổi biển = xóa + đăng ký lại UC1). KHÔNG admin route (owed sau). KHÔNG list/xem (UC3). KHÔNG hard-delete. KHÔNG restore/un-delete (owed). KHÔNG migration. KHÔNG camera.

## 2. DTO (đề xuất — mô tả, KHÔNG code)
- `UpdateVehicleRegistrationDto` (PATCH metadata): `vehicle_type?` (`@Expose('vehicle_type') @IsOptional @IsString @MaxLength(50)`), `note?` (`@IsOptional @IsString @MaxLength(255)`). **KHÔNG** field `plate_number`/`plate_raw`/`user_id`/`status` (whitelist loại field thừa). Cả 2 absent → no-op (OQ-5).
- `UpdateVehicleStatusDto` (PATCH /status): `status` (`@IsIn(['active','disabled'])` required) (OQ-2).

## 3. Service (đề xuất — thêm vào `VehicleRegistrationService`, OQ-5)
- **`private loadOwned(id, userId): Promise<Entity>`** (crux ownership): `repo.findOne({where:{id, userId, deletedAt: IsNull()}})` → null → `NotFoundException({code:'VEHICLE_NOT_FOUND', message:'Không tìm thấy biển số'})`. Dùng chung cả 3 thao tác.
- `updateMetadata(id, userId, dto)`: `loadOwned` → cập nhật `vehicleType`/`note` (chỉ field gửi) → `repo.save` → trả entity.
- `setStatus(id, userId, status)`: `loadOwned` → `entity.status = status` → `repo.save` → trả entity.
- `softDeleteOwned(id, userId)`: `loadOwned` (đảm bảo của mình + chưa xóa) → `repo.softDelete(id)` → trả void/id.
- SEC-03: dùng repo (bind tham số). Mirror UC1 (controller→service→repo).

## 4. Controller (đề xuất — 3 route)
- Tất cả `@Controller('anpr/vehicle-registrations')` (hoặc nối path), `@UseGuards(JwtAuthGuard)`, `:id` `ParseUUIDPipe`, `userId` từ `@CurrentUser()`, `@UsePipes(ValidationPipe whitelist/transform)`.
- `@Patch(':id')` → `updateMetadata` → `{success, message:'Vehicle updated successfully', data: toVehicleRegistrationResponse(entity)}` (200).
- `@Patch(':id/status')` → `setStatus` → envelope + entity (200).
- `@Delete(':id')` → `softDeleteOwned` → `{success, message:'Vehicle deleted successfully', data: null}` (200) (OQ-4).

## 5. Requirements (EARS)
- **R1**: **WHEN** user gửi `PATCH /:id` với `note`/`vehicle_type` hợp lệ trên biển CỦA MÌNH **→** cập nhật đúng 2 field đó, trả 200 + bản ghi (qua mapper).
- **R2**: **WHEN** user gửi `PATCH /:id/status` với `status ∈ {active, disabled}` trên biển của mình **→** đổi status, trả 200 + bản ghi.
- **R3**: **WHEN** user gửi `DELETE /:id` trên biển của mình **→** soft-delete (`deletedAt` set), trả 200 `{success,message,data:null}`.
- **R4 (crux SEC)**: **IF** `:id` KHÔNG tồn tại / đã xóa-mềm / **KHÔNG thuộc current user** **→** `404 VEHICLE_NOT_FOUND` (cả 3 route), KHÔNG tiết lộ biển người khác, KHÔNG thao tác.
- **R5**: **WHILE** xử lý mọi route, `userId` PHẢI từ JWT (`@CurrentUser`), KHÔNG từ body/param.
- **R6**: **IF** body PATCH chứa `plate_number`/`plate_raw`/`user_id`/`status` (ở route metadata) **→** ValidationPipe `whitelist` loại bỏ; KHÔNG cho đổi biển/chủ qua UC2.
- **R7**: **IF** `status` ngoài `{active, disabled}` **→** `400` validate fail, KHÔNG đổi.

## 6. Constitution
- **SEC-01 (ownership — crux)**: mọi thao tác lookup `WHERE id AND userId=current AND deletedAt IS NULL`; không khớp → 404. Chặn user A sửa/xóa biển user B. `userId` từ JWT.
- **SEC-02 (giấu tồn tại)**: ownership-fail trả **404** (KHÔNG 403) để không lộ biển người khác tồn tại (OQ-1).
- **ARCH-01**: controller→service→repo, mirror UC1; thêm method vào `VehicleRegistrationService` (OQ-5).
- **DATA-01 (sửa giới hạn)**: PATCH metadata CHỈ `note` + `vehicle_type`; KHÔNG `plate_number`/`plate_raw`/`user_id`/`status`.
- **DATA-02 (disable/xóa)**: disable = `status 'active'↔'disabled'` (route /status riêng); xóa = soft-delete (`repo.softDelete` → `deletedAt`), KHÔNG hard-delete.
- **DATA-03**: no-migration (bảng + cột + soft-delete đã có).
- **VAL-01**: DTO `class-validator` + `ValidationPipe({whitelist,transform})`; `status` `@IsIn(['active','disabled'])`; `:id` `ParseUUIDPipe`.

## 7. OPEN QUESTIONS — ĐÃ CHỐT
- **OQ-1 (crux) ownership-fail code — CHỐT: 404 `VEHICLE_NOT_FOUND`.** Fold ownership vào query (`findOne({where:{id, userId, deletedAt:IsNull()}})` → null → 404). KHÔNG dùng 403, KHÔNG lộ tồn tại biển người khác. (Lệch precedent meetings §0.2 có chủ đích — privacy.)
- **OQ-2 status values — CHỐT**: `status ∈ {'active','disabled'}` (đúng 2 giá trị), `@IsIn(['active','disabled'])`.
- **OQ-3 tách /status route — CHỐT**: route `/:id/status` riêng cho enable/disable; KHÔNG gộp `status` vào PATCH metadata.
- **OQ-4 delete response — CHỐT**: `DELETE` trả `{success, message:'Vehicle deleted successfully', data: null}`.
- **OQ-5 service — CHỐT**: thêm method vào `VehicleRegistrationService` (KHÔNG tách service mới). PATCH metadata rỗng (cả `note`+`vehicle_type` absent) → **no-op, trả 200 bản ghi nguyên trạng** (KHÔNG 400).

## 8. Residuals / known-gaps
- **Admin route owed**: UC2 chỉ user tự quản; admin sửa/xóa hộ (cần PermissionsGuard + body userId) defer.
- **Restore/un-delete owed**: xóa-mềm rồi muốn khôi phục — chưa làm (UC2 chỉ xóa). Partial-unique `WHERE deleted_at IS NULL` cho phép đăng ký lại biển đã xóa (UC1).
- **Status mở rộng**: thêm giá trị status tương lai KHÔNG cần migration (`varchar` no-CHECK) nhưng phải cập nhật enum validate.
- **Ownership precedent lệch**: repo meetings dùng 403 (lộ tồn tại); UC2 chọn 404 (privacy) — ghi rõ khác biệt, chốt OQ-1.
- **UC3 (list/xem)** ngoài UC2 — cần để user thấy `id` biển của mình trước khi PATCH/DELETE (client hiện phải có id từ UC1 response/UC3).

> **STOP.** Spec-only. Chờ Thiếu Chủ review §0 RECON + chốt OQ-1…OQ-5 trước khi plan/tasks. KHÔNG tự code.
