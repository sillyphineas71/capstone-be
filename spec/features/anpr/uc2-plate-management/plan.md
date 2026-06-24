# VPM-001 — plan.md (UC2 ANPR: sửa/disable/xóa-mềm biển)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo plan VPM-001 sau spec DUYỆT + chốt OQ-1…5. Crux ownership fold-vào-query → 404. 4 method thêm vào VehicleRegistrationService, 3 route, 2 DTO. No-migration. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)
- **`repo.softDelete(id)`** (TypeORM, set `deletedAt` qua `@DeleteDateColumn`) — tiền lệ [media-files.service.ts:140](../../../../src/modules/recording/services/media-files.service.ts). Entity [vehicle-registration.entity.ts](../../../../src/modules/anpr/entities/vehicle-registration.entity.ts) **đã có `@DeleteDateColumn deletedAt`** → `softDelete` chạy được, no-migration.
- **`@Param('id', ParseUUIDPipe)`** — tiền lệ [iot-devices.controller.ts:61](../../../../src/modules/iot/controllers/iot-devices.controller.ts).
- **UC1 đã wiring** controller + service trong [anpr.module.ts](../../../../src/modules/anpr/anpr.module.ts) → UC2 thêm method/route vào file CÓ SẴN → **module KHÔNG đổi**.
- **Ownership precedent** [meetings.service.ts:656-686](../../../../src/modules/meetings/services/meetings.service.ts): 404-thiếu rồi 403-không-chủ (lộ tồn tại). UC2 chốt **404 fold-vào-query** (OQ-1, privacy).

## 1. Quyết định đã chốt (OQ + Constitution)
OQ-1 **404 fold-ownership** (`findOne({id,userId,deletedAt:IsNull()})`→null→404) · OQ-2 `status∈{active,disabled}` `@IsIn` · OQ-3 tách route `/:id/status` · OQ-4 DELETE trả `{data:null}` · OQ-5 thêm method vào `VehicleRegistrationService` + PATCH rỗng→no-op 200.
- **SEC-01 (crux)** mọi thao tác lookup `WHERE id AND userId=current AND deletedAt IS NULL` → chặn user A đụng biển user B; `userId` từ JWT. **SEC-02** ownership-fail = 404 (giấu tồn tại). **ARCH-01** controller→service→repo, mirror UC1. **DATA-01** PATCH chỉ `note`+`vehicle_type`. **DATA-02** disable=status `active↔disabled` (route /status); xóa=soft-delete (`repo.softDelete`), KHÔNG hard-delete. **DATA-03** no-migration. **VAL-01** DTO validate + `@IsIn` status + `ParseUUIDPipe` cho `:id`.

## 2. Service — 4 method thêm vào `VehicleRegistrationService` (OQ-5)
- **`private async loadOwned(id, userId): Promise<VehicleRegistrationEntity>`** (CRUX): `repo.findOne({where:{id, userId, deletedAt: IsNull()}})` → null → `NotFoundException({code:'VEHICLE_NOT_FOUND', message:'Không tìm thấy biển số'})`. Dùng chung cả 3 thao tác (1 nguồn ownership+existence+soft-delete).
- **`updateMetadata(id, userId, dto: UpdateVehicleRegistrationDto)`**: `loadOwned` → set `vehicleType`/`note` CHỈ field gửi (`!== undefined`); nếu KHÔNG field nào gửi → **no-op, return entity nguyên trạng** (không `save`) (OQ-5). Có field → `repo.save` → return entity.
- **`setStatus(id, userId, status: 'active'|'disabled')`**: `loadOwned` → `entity.status = status` → `repo.save` → return entity.
- **`softDeleteOwned(id, userId)`**: `loadOwned` (đảm bảo của mình + chưa xóa) → `repo.softDelete(id)` → return void.
- SEC-03 dùng repo (bind tham số). KHÔNG đụng `register` (UC1) — chỉ thêm method.

## 3. DTO (2 mới)
- `dto/update-vehicle-registration.dto.ts` (PATCH metadata): `vehicle_type?` (`@Expose('vehicle_type') @IsOptional @IsString @MaxLength(50)`), `note?` (`@IsOptional @IsString @MaxLength(255)`). KHÔNG `plate_number`/`plate_raw`/`user_id`/`status` → `whitelist:true` loại field thừa (DATA-01).
- `dto/update-vehicle-status.dto.ts` (PATCH /status): `status` (`@IsIn(['active','disabled'])` required) (OQ-2). (Có thể export type `VehicleStatus = 'active'|'disabled'` để service dùng.)

## 4. Controller — 3 route thêm vào `VehicleRegistrationController`
Tất cả `@UseGuards(JwtAuthGuard)`, `@Param('id', ParseUUIDPipe)`, `userId` từ `@CurrentUser()`, `@UsePipes(ValidationPipe{whitelist:true,transform:true})`, envelope inline mirror UC1.
- `@Patch('vehicle-registrations/:id')` → `updateMetadata(id, user.userId, dto)` → `{success:true, message:'Vehicle updated successfully', data: toVehicleRegistrationResponse(entity)}` (200).
- `@Patch('vehicle-registrations/:id/status')` → `setStatus(id, user.userId, dto.status)` → envelope + entity (200).
- `@Delete('vehicle-registrations/:id')` → `softDeleteOwned(id, user.userId)` → `{success:true, message:'Vehicle deleted successfully', data: null}` (200) (OQ-4).
- (Controller base hiện `@Controller('anpr')` — path method nối `vehicle-registrations/:id` cho khớp UC1 `POST vehicle-registrations`.)

## 5. File list
### Net-new
- `src/modules/anpr/dto/update-vehicle-registration.dto.ts`
- `src/modules/anpr/dto/update-vehicle-status.dto.ts`
### Modified
- `src/modules/anpr/services/vehicle-registration.service.ts` (+ `loadOwned`/`updateMetadata`/`setStatus`/`softDeleteOwned`) (+ `.spec.ts` thêm test)
- `src/modules/anpr/controllers/vehicle-registration.controller.ts` (+ 3 route) (+ `.spec.ts` thêm test)
> Tổng **2 net-new + 4 modified** (2 code + 2 spec). 0 migration. `anpr.module.ts` KHÔNG đổi (controller/service đã registered).

## 6. Test (mock repo — KHÔNG DB)
- **Ownership (BẮT BUỘC)**: user A thao tác biển user B → `loadOwned` (findOne với userId khác) trả null → **404 VEHICLE_NOT_FOUND** cho cả 3 method (update/status/delete); assert KHÔNG `save`/`softDelete`.
- biển không tồn tại → 404; biển đã xóa-mềm (findOne lọc `deletedAt IsNull` → null) → 404 (KHÔNG xóa 2 lần).
- `updateMetadata`: chỉ đổi `note`/`vehicleType` (assert KHÔNG đụng `plateNumber`/`userId`/`status`); PATCH rỗng (cả 2 absent) → no-op, KHÔNG `save`, trả entity nguyên trạng (OQ-5).
- `setStatus`: 'active'/'disabled' → `save` với status mới.
- `softDeleteOwned`: gọi `repo.softDelete(id)` sau khi `loadOwned` ok.
- DTO/validate (controller hoặc e2e-lite): status ngoài enum → 400 (`@IsIn`); whitelist loại `plate_number`/`user_id` khỏi body PATCH.
- controller: userId lấy từ `@CurrentUser` (KHÔNG body/param); envelope đúng shape; DELETE trả `data:null`.
- Coverage **≥80%** method mới.

## 7. Gate (STOP, KHÔNG commit)
- build=0; eslint touched (2 dto + service + controller + 2 spec) baseline-proof **0 rule mới**, file mới 0; `npx jest src/modules/anpr` xanh; coverage ≥80% method mới; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies). **KHÔNG live, KHÔNG DB.**
- **Owed (ghi, KHÔNG chạy)**: admin route sửa/xóa hộ (PermissionsGuard + body userId) · restore/un-delete · UC3 list (user cần `id` biển) · live smoke 3 route khi có DB.

## 8. Kỷ luật
- **No-migration** (cột + soft-delete đã có). **SEC-01/02** ownership fold-vào-query → 404 (giấu tồn tại); `userId` từ JWT. **DATA-01** sửa CHỈ `note`/`vehicle_type`. **DATA-02** soft-delete (KHÔNG hard-delete); disable=status. **ARCH-01** mirror UC1 (controller→service→repo, envelope inline, `@InjectRepository`).
- KHÔNG đụng `register` (UC1) · KHÔNG đổi `anpr.module` · KHÔNG admin route (owed).

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan → sang tasks. KHÔNG code.
