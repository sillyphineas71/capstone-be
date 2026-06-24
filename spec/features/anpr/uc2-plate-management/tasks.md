# VPM-001 — tasks.md (UC2 ANPR: sửa/disable/xóa-mềm biển)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo tasks VPM-001: T0 verify → T1 DTO×2 → T2 service 4 method (loadOwned crux) → T3 controller 3 route → T-GATE. Mỗi task 1 AC, code/test tách. Ownership = test bắt buộc. No-migration. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. No-migration. KHÔNG đụng `register` (UC1)/`anpr.module`. UC1 KHÔNG hồi quy.

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T3b → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận đọc CODE THẬT: entity có `@DeleteDateColumn deletedAt` → `repo.softDelete(id)` dùng được; `ParseUUIDPipe` import `@nestjs/common`; `@IsIn` import `class-validator`; `IsNull` import `typeorm`; `VehicleRegistrationService` + `VehicleRegistrationController` + `toVehicleRegistrationResponse` (UC1) còn nguyên để thêm method/route.
- **AC**: dán xác nhận 5 mục; thiếu/path sai → **DỪNG báo Thiếu Chủ** (không bịa).

## T1 — DTO ×2 (code) — plan §3, OQ-2, DATA-01
- `dto/update-vehicle-registration.dto.ts`: `vehicle_type?` (`@Expose('vehicle_type') @IsOptional @IsString @MaxLength(50)`), `note?` (`@IsOptional @IsString @MaxLength(255)`). KHÔNG field `plate_number`/`plate_raw`/`user_id`/`status`.
- `dto/update-vehicle-status.dto.ts`: `status` (`@IsIn(['active','disabled'])` required); export type `VehicleStatus = 'active' | 'disabled'`.
- **AC**: update DTO chỉ 2 field (note/vehicle_type); status DTO `@IsIn` 2 giá trị; KHÔNG field cấm.

## T2 — Service 4 method thêm vào `VehicleRegistrationService` (code) — plan §2, SEC-01/02, OQ-1/5
- `loadOwned(id, userId)` **private** (CRUX): `repo.findOne({where:{id, userId, deletedAt: IsNull()}})` → null → `NotFoundException({code:'VEHICLE_NOT_FOUND', message:'Không tìm thấy biển số'})` (message trung tính, KHÔNG lộ tồn tại). Dùng chung cả 3.
- `updateMetadata(id, userId, dto)`: `loadOwned` → set `vehicleType`/`note` theo `!== undefined` (gửi null → set null xóa note; KHÔNG gửi → giữ nguyên); KHÔNG field nào gửi → **no-op, KHÔNG save, trả entity nguyên trạng**; có field → `save` → trả entity.
- `setStatus(id, userId, status)`: `loadOwned` → `entity.status = status` → `save` → trả entity.
- `softDeleteOwned(id, userId)`: `loadOwned` → `repo.softDelete(id)` → trả void.
- KHÔNG đụng `register`.
- **AC**: cả 3 thao tác đi qua `loadOwned`; ownership/existence/soft-delete fold vào 1 query → null → 404; `updateMetadata` chỉ chạm `note`/`vehicleType`.

## T2b — Service test (mock repo) — SEC-01 (ownership BẮT BUỘC), OQ-5
- **Ownership**: user A đụng biển user B (`findOne` userId khác → null) → 404 cho **cả 3** method; assert KHÔNG `save`/`softDelete`.
- không tồn tại → 404; đã xóa-mềm (`findOne` lọc `deletedAt IsNull` → null) → 404 (softDelete KHÔNG gọi 2 lần).
- `updateMetadata`: chỉ đổi `note`/`vehicleType` (KHÔNG đụng `plateNumber`/`userId`/`status`); **ca undefined** (không gửi note) → giữ nguyên; **ca null** (`note=null`) → set null; **ca rỗng** (cả 2 absent) → no-op, KHÔNG `save`, trả nguyên trạng.
- `setStatus`: 'active' và 'disabled' → `save` status mới.
- `softDeleteOwned`: gọi `repo.softDelete(id)` sau `loadOwned` ok.
- **AC**: các nhánh xanh; ownership 404 ×3 chứng minh KHÔNG save/softDelete.

## T3 — Controller 3 route thêm vào `VehicleRegistrationController` (code) — plan §4, OQ-1/3/4
- Tất cả `@UseGuards(JwtAuthGuard)`, `@Param('id', ParseUUIDPipe)`, `userId` từ `@CurrentUser()`, `@UsePipes(ValidationPipe{whitelist:true,transform:true})`.
  - `@Patch('vehicle-registrations/:id')` → `updateMetadata` → `{success, message:'Vehicle updated successfully', data: toVehicleRegistrationResponse(entity)}` (200).
  - `@Patch('vehicle-registrations/:id/status')` → `setStatus(id, userId, dto.status)` → envelope + entity (200).
  - `@Delete('vehicle-registrations/:id')` → `softDeleteOwned` → `{success, message:'Vehicle deleted successfully', data: null}` (200).
- **AC**: 3 route đúng method/path; userId từ `@CurrentUser` (KHÔNG body/param); DELETE trả `data:null`; cùng mapper/envelope mirror UC1.

## T3b — Controller test (mock service + mock guard) — SEC-01, DATA-01, VAL-01
- update route → gọi `service.updateMetadata(id, currentUserId, dto)`; status route → `setStatus(id, currentUserId, dto.status)`; delete route → `softDeleteOwned(id, currentUserId)` + trả `data:null`.
- whitelist: body PATCH có `plate_number`/`user_id` → bị loại (service nhận dto KHÔNG chứa field cấm).
- (validate) status ngoài enum → 400 (`@IsIn`); guard list = JwtAuthGuard.
- **AC**: assert userId từ `@CurrentUser` (không body); whitelist loại field cấm; DELETE `data:null`.

## T-GATE — (STOP, KHÔNG commit) — plan §7
- build=0; eslint touched (2 dto + service + controller + 2 spec) baseline-proof **0 rule mới**, file mới 0; `npx jest src/modules/anpr` xanh (**UC1 cũ KHÔNG hồi quy + UC2 mới**); coverage **≥80%** method mới; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies); throwaway xóa. **KHÔNG live, KHÔNG DB, KHÔNG commit.**
- In: code đầy đủ file + jest + coverage + báo cáo gate.
- **Owed (ghi, KHÔNG chạy)**: admin route sửa/xóa hộ (PermissionsGuard + body userId) · restore/un-delete · UC3 list (user cần `id` biển) · live smoke 3 route khi có DB.
- **AC**: bảng gate đầy đủ + báo cáo: ownership 404 fold ×3 ✓ · 404 không 403 (giấu tồn tại) ✓ · PATCH chỉ note/vehicle_type (whitelist loại field cấm) ✓ · undefined-giữ / null-clear / rỗng-no-op ✓ · status `@IsIn` ✓ · soft-delete (không hard) ✓ · userId từ JWT ✓ · UC1 không hồi quy ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC2
- T0 → verify imports/UC1 còn nguyên
- T1 → DTO update metadata + update status
- T2/T2b → service `loadOwned` (CRUX ownership) + updateMetadata/setStatus/softDeleteOwned
- T3/T3b → controller 3 route (PATCH /:id, PATCH /:id/status, DELETE /:id)
- T-GATE → gate + STOP + Owed (admin · restore · UC3 list · live smoke)
