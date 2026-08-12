# VPT-001 — tasks.md (Biển số xe tự hết hạn theo tài khoản đối tác)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-08-12 | Tạo tasks VPT-001: T0 verify → T1/T1b resolve fix + test → T2 index migration → T3/T3b AllowPartnerAccount + test → T4/T4b route DELETE admin (service+controller) + test → T5 permission migration → T6/T6b DTO field + test → T-GATE. 12 task, mỗi task 1 AC, code/test tách. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. 0 net-new module/entity/table (chỉ 2 migration net-new). VPT-BE-04 KHÔNG có task (đã chốt không code — spec §6 quyết định 3). UC1-9/UC-101 KHÔNG hồi quy.

## Thứ tự
T0 → T1 → T1b → T2 → T3 → T3b → T4 → T4b → T5 → T6 → T6b → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận đọc CODE THẬT: `resolveUserByPlate()` trong `vehicle-resolve.service.ts` (dòng 468-479, chữ ký + `UserRow`/`ResolvedVehicle` interface); `admin-vehicle-registration-response.dto.ts` (toàn bộ 39 dòng); `vehicle-registration.service.ts` (`listAll()` đã join `user`, `loadOwned`/`softDeleteOwned` pattern); `vehicle-registration.controller.ts` (vị trí `historyOwn`/`list`/nhóm route admin/route `DELETE` user); `allow-partner-account.decorator.ts`; migration mẫu `20260722000006-SeedAnprVehicleAdminReadPermission.ts`; migration mới nhất trong repo (để chọn timestamp không trùng).
- **AC**: dán xác nhận 7 mục; thiếu/path sai/đã đổi khác spec/plan → **DỪNG báo Thiếu Chủ** (không bịa, không tự suy đoán tiếp).

## T1 — Sửa `resolveUserByPlate()` (code) — plan §2.1, spec R1/R2/R9, Constitution SEC-03
- File: `src/modules/anpr/services/vehicle-resolve.service.ts`.
- Đổi nội dung method (giữ nguyên chữ ký `private async resolveUserByPlate(plateNumber: string): Promise<ResolvedVehicle | null>`, giữ nguyên `UserRow`/`ResolvedVehicle` interface, giữ nguyên call site dòng 108):
  ```sql
  SELECT vr.id, vr.user_id FROM vehicle_registrations vr
  JOIN users u ON u.id = vr.user_id
  WHERE vr.plate_number = $1 AND vr.status = 'active' AND vr.deleted_at IS NULL
    AND u.deleted_at IS NULL
    AND (u.account_expires_at IS NULL OR u.account_expires_at >= NOW())
  LIMIT 1
  ```
- Cập nhật JSDoc method (dòng 464-467) — thêm 1 dòng nêu điều kiện hết hạn/xoá tài khoản (VPT-001).
- **KHÔNG** đụng phần còn lại của `onVehicleEvent()` (matchState/payload/gate-log logic nguyên vẹn).
- **AC**: biển active + user không hết hạn + không xoá → trả `{userId, vehicleRegistrationId}` như cũ; biển active + (`account_expires_at` quá khứ HOẶC `deleted_at` khác null) → trả `null`; biển disabled/không tồn tại → vẫn `null` như trước (không hồi quy).

## T1b — Test cho T1 (test) — plan §2.3, spec R1-R4
- File: `src/modules/anpr/services/vehicle-resolve.service.spec.ts`.
- Thêm case (mirror `wire()`/`payloadOf()`/`insert()` helper có sẵn, dòng 23-80):
  1. **hết hạn/xoá tài khoản → unmatched**: `wire({ user: [] })` → `onVehicleEvent(evt())` → `payloadOf().userId === null`, `payloadOf().matchState === 'unmatched'`, `insert().params[3] === 'unmatched'`.
  2. **`account_expires_at = null` (nhân viên thường) → matched như cũ**: dùng default `wire()` (không override `user`) → `payloadOf().userId === 'u1'`, `matchState === 'matched'`.
  3. **đã gia hạn → matched**: cùng mock case 2 (ghi rõ trong comment test: mock raw-SQL không phân biệt được lý do "vì sao có/không có row", chỉ assert hành vi 2 nhánh có/không có kết quả — giới hạn đã ghi ở plan §2.3, không phải thiếu sót).
- **AC**: 3 case xanh; UC1-9 test cũ trong cùng file (matched/unmatched/C1-isolation/direction/parseUtc/NotThrow/device-chưa-seed/SEC-01) vẫn xanh, không sửa assertion cũ.

## T2 — Migration index `idx_users_account_expires_at` (code) — plan §2.2
- File mới: `src/database/migrations/20260812000003-AddIndexUsersAccountExpiresAt.ts`.
- `up()`: `CREATE INDEX IF NOT EXISTS idx_users_account_expires_at ON users (account_expires_at) WHERE account_expires_at IS NOT NULL;`
- `down()`: `DROP INDEX IF EXISTS idx_users_account_expires_at;`
- **AC**: migration compile, `up()`/`down()` đối xứng (drop đúng index vừa tạo), KHÔNG đụng bảng/cột khác.

## T3 — `@AllowPartnerAccount()` cho 2 route self-service (code) — plan §2.4, spec R5
- File: `src/modules/anpr/controllers/vehicle-registration.controller.ts`.
- Thêm import `AllowPartnerAccount` từ `../../../common/decorators/allow-partner-account.decorator.js`.
- Gắn `@AllowPartnerAccount()` lên `historyOwn()` và `list()`. **KHÔNG** gắn lên `historyAll()`, `listAll()`, `registerForUser()`.
- **AC**: 2 route user có metadata `ALLOW_PARTNER_ACCOUNT_KEY = true`; các route admin/POST không có.

## T3b — Test cho T3 (test) — plan §4
- File: `src/modules/anpr/controllers/vehicle-registration.controller.spec.ts`.
- Import `ALLOW_PARTNER_ACCOUNT_KEY` từ decorator. Thêm assertion (mirror pattern `Reflect.getMetadata('__guards__', controller.method)`/`PERMISSIONS_KEY` đã có, dòng 68-85):
  - `Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, controller.historyOwn) === true`.
  - `Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, controller.list) === true`.
  - `Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, controller.historyAll)` falsy.
  - `Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, controller.listAll)` falsy.
  - `Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, controller.registerForUser)` falsy.
- **AC**: 5 assertion xanh.

## T4 — Route `DELETE /anpr/admin/vehicle-registrations/:id` (code) — plan §2.5, spec R6/R7
- **Service** `src/modules/anpr/services/vehicle-registration.service.ts` — thêm method mới cạnh `softDeleteOwned` (dòng ~263):
  ```ts
  async adminSoftDelete(id: string): Promise<void> {
    const entity = await this.repo.findOne({ where: { id, deletedAt: IsNull() } });
    if (!entity) {
      throw new NotFoundException({
        code: 'VEHICLE_NOT_FOUND_OR_FORBIDDEN',
        message: 'Không tìm thấy biển số',
      });
    }
    await this.repo.softDelete(id);
  }
  ```
  **KHÔNG** fold `userId` (khác `softDeleteOwned`/`loadOwned`).
- **Controller** `src/modules/anpr/controllers/vehicle-registration.controller.ts` — thêm route trong nhóm admin (sau `POST admin/vehicle-registrations`, **trước** `@Delete('vehicle-registrations/:id')` route user):
  ```ts
  @Delete('admin/vehicle-registrations/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('anpr.vehicle.admin_delete')
  @ApiOperation({ summary: 'Admin xoá mềm 1 biển số của bất kỳ user nào (không cần là chủ xe)' })
  async removeAsAdmin(@Param('id', ParseUUIDPipe) id: string) {
    await this.vehicleRegistrationService.adminSoftDelete(id);
    return { success: true, message: 'Vehicle deleted successfully', data: null };
  }
  ```
- **AC**: guard = `JwtAuthGuard`+`PermissionsGuard`; permission = `['anpr.vehicle.admin_delete']`; id tồn tại → `repo.softDelete` gọi đúng 1 lần, response `{success:true, message:'Vehicle deleted successfully', data:null}`; id không tồn tại/đã xoá → ném `NotFoundException` code `VEHICLE_NOT_FOUND_OR_FORBIDDEN`, KHÔNG gọi `softDelete`.

## T4b — Test cho T4 (test) — plan §4
- File: `src/modules/anpr/services/vehicle-registration.service.spec.ts` (test `adminSoftDelete`) + `vehicle-registration.controller.spec.ts` (test route mới, mirror pattern guard/permission dòng 75-85).
- **Service**: mock `repo.findOne` trả entity → `softDelete` được gọi với đúng `id`; mock `repo.findOne` trả `undefined` → ném đúng `NotFoundException` + code, `softDelete` KHÔNG được gọi.
- **Controller**: `service.adminSoftDelete = jest.fn().mockResolvedValue(undefined)` → gọi `removeAsAdmin('veh1')` → assert `service.adminSoftDelete` gọi với `'veh1'`, response envelope đúng shape; guard/permission metadata đúng như AC T4.
- **AC**: cả 2 file xanh, không sửa test cũ trong 2 file này.

## T5 — Migration seed permission `anpr.vehicle.admin_delete` (code) — plan §2.6
- File mới: `src/database/migrations/20260812000004-SeedAnprVehicleAdminDeletePermission.ts`.
- Copy nguyên cấu trúc `20260722000006-SeedAnprVehicleAdminReadPermission.ts` (INSERT permissions ON CONFLICT DO NOTHING RETURNING id → fallback SELECT nếu đã tồn tại → loop INSERT role_permissions ON CONFLICT DO NOTHING cho từng role → `down()` xoá role_permissions rồi permissions theo code).
- Đổi field: `code: 'anpr.vehicle.admin_delete'`, `action: 'admin_delete'`, `name`/`description` mô tả xoá hộ; **giữ nguyên** `roles = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN']`.
- **AC**: migration compile; `up()` idempotent (chạy 2 lần không lỗi, không tạo trùng); `down()` xoá đúng permission + role_permissions liên quan, KHÔNG đụng permission khác.

## T6 — `AdminVehicleRegistrationResponseDto` + mapper + comment (code) — plan §2.7, spec R8
- File: `src/modules/anpr/dto/admin-vehicle-registration-response.dto.ts`.
- Thêm field `account_expires_at: string | null` vào interface (top-level, ngoài `owner`).
- Sửa mapper: `account_expires_at: entity.user?.accountExpiresAt?.toISOString() ?? null`.
- Sửa comment JSDoc phía trên `AdminVehicleOwner` — thêm câu ghi rõ `account_expires_at` là ngoại lệ có chủ đích (VPT-001), không phải nới lỏng SEC-01.
- **KHÔNG** sửa `vehicle-registration.service.ts::listAll()` (đã join `user` sẵn).
- **AC**: interface có field mới; mapper map đúng 3 case (có giá trị / `null` / `entity.user` null).

## T6b — Test cho T6 (test) — plan §4
- File: `src/modules/anpr/dto/admin-vehicle-registration-response.dto.spec.ts`.
- Thêm case: `entity.user.accountExpiresAt = new Date(...)` → `out.account_expires_at` = đúng ISO string; `entity.user.accountExpiresAt = null` → `out.account_expires_at === null`; `entity.user = null` → `out.account_expires_at === null` (không nổ, cùng nhánh với `out.owner === null`).
- **AC**: 3 case xanh; 3 test cũ trong file (owner shape, field nhạy cảm không lộ, giữ nguyên field xe) không đổi assertion, vẫn xanh.

## T-GATE — (STOP, KHÔNG commit) — plan §5
- build=0; eslint touched (8 file modified + 2 migration net-new) baseline-proof **0 rule mới**, 0 file mới ngoài 2 migration; `npx jest src/modules/anpr` xanh (**UC1-9/UC-101 KHÔNG hồi quy** + toàn bộ case mới T1b/T3b/T4b/T6b); coverage **≥80%** cho `resolveUserByPlate` (nhánh mới), `adminSoftDelete`, mapper `toAdminVehicleRegistrationResponse`; DI-proof compile `AppModule` (0 circular/UnknownDependencies, route mới resolve đúng permission qua `PermissionsGuard`). **KHÔNG live, KHÔNG chạy migration lên RDS chung, KHÔNG commit.**
- Nếu sửa eslint: đọc lại file sau khi sửa, KHÔNG sed/regex hàng loạt làm rỗng assertion.
- In: code đầy đủ 8 file modified + 2 migration + jest + coverage + báo cáo gate.
- **Owed runbook (ghi, KHÔNG chạy)**: OQ-3 (spec §7) — hỏi đội phần cứng (Hải) xem camera/IVSS có tra `matched`/`unmatched` từ BE để quyết định mở cổng vật lý hay không, trước khi công bố "đã chặn được cổng" trong demo/báo cáo · áp 2 migration mới lên RDS chung là bước release riêng, ngoài phạm vi tasks này.
- **AC**: bảng gate đầy đủ + báo cáo: resolve hết hạn/xoá tài khoản → unmatched ✓ · resolve nhân viên thường/đã gia hạn → matched như cũ ✓ · index migration đối xứng ✓ · 2 route self-service qua được `PartnerAccountRestrictionGuard` ✓ · route DELETE admin đúng guard/permission/404 ✓ · permission `admin_delete` seed đúng 2 role, idempotent ✓ · `account_expires_at` map đúng 3 case ✓ · comment SEC-01 đã cập nhật ✓ · UC1-9/UC-101 không hồi quy ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope VPT-001
- T0 → verify code thật (resolve/DTO/service/controller/decorator/migration mẫu/timestamp mới nhất)
- T1/T1b → VPT-BE-01 + quyết định 4 (JOIN `users` + `deleted_at` + `account_expires_at`)
- T2 → VPT-BE-02 (migration index)
- T3/T3b → VPT-BE-07 (`@AllowPartnerAccount()` cho self-service)
- T4/T4b → VPT-BE-05 (route + service xoá hộ admin)
- T5 → VPT-BE-05 phần permission seed (`anpr.vehicle.admin_delete`)
- T6/T6b → VPT-BE-06 (`account_expires_at` trong response admin)
- T-GATE → gate + STOP + Owed runbook (OQ-3 phần cứng · áp migration lên RDS chung)
- *(VPT-BE-04: không có task — đã chốt không code, spec §6 quyết định 3)*
