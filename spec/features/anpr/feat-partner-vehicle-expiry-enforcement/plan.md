# VPT-001 — plan.md (Biển số xe tự hết hạn theo tài khoản đối tác)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-08-12 | Tạo plan VPT-001 sau khi spec duyệt (4 quyết định §6 spec đã chốt, KHÔNG mở lại). 7 hạng mục code cụ thể: (1) sửa `resolveUserByPlate()` JOIN `users` + `deleted_at`; (2) migration index `idx_users_account_expires_at`; (3) test 3 case cho (1); (4) `@AllowPartnerAccount()` cho 2 route self-service; (5) route `DELETE` admin + service `adminSoftDelete()`; (6) migration seed permission `anpr.vehicle.admin_delete`; (7) field `account_expires_at` + sửa comment SEC-01 trong `AdminVehicleRegistrationResponseDto`. VPT-BE-04 KHÔNG có hạng mục (đã chốt không code). | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định §6 của spec (permission `admin_delete` riêng, `account_expires_at` top-level, không route `/users/:userId/vehicles`, thêm `u.deleted_at IS NULL`).

---

## 0. RECON (đọc lại CODE THẬT ngay trước khi lên plan — xác nhận đủ để code)

Toàn bộ RECON chi tiết đã nằm ở [spec.md §0](./spec.md#0-recon-findings-đã-đọc-code-thật). Plan chỉ nhắc lại đúng những gì cần để viết code, không lặp lại phân tích.

- **`resolveUserByPlate()`** ([vehicle-resolve.service.ts:468-479](../../../../src/modules/anpr/services/vehicle-resolve.service.ts)): raw SQL qua `this.dataSource.manager.query(sql, params)`, trả `UserRow[]` (`{id, user_id}`), map sang `ResolvedVehicle | null`. Style bind-param `$1`, không ORM repository ở service này (mirror face ingestion, xem comment đầu file).
- **`admin-vehicle-registration-response.dto.ts`** (toàn bộ, 39 dòng): `AdminVehicleOwner` interface (3 field), `AdminVehicleRegistrationResponseDto extends VehicleRegistrationResponseDto { owner }`, mapper `toAdminVehicleRegistrationResponse(entity)` spread `toVehicleRegistrationResponse(entity)` rồi gắn `owner`.
- **`vehicle-registration.service.ts`**: `listAll()` đã `leftJoinAndSelect('vr.user','u')` ([:183](../../../../src/modules/anpr/services/vehicle-registration.service.ts)) — entity trả về có sẵn `entity.user.accountExpiresAt`. `loadOwned(id, userId)` ([:100-114](../../../../src/modules/anpr/services/vehicle-registration.service.ts)) fold `userId` — **KHÔNG tái dùng được cho admin** (đúng ý, cần method mới không fold). `softDeleteOwned()` ([:263-266](../../../../src/modules/anpr/services/vehicle-registration.service.ts)) pattern: `loadOwned` rồi `this.repo.softDelete(id)`.
- **`vehicle-registration.controller.ts`**: `historyOwn()` (dòng ~59-77), `list()` (dòng ~138-156) — 2 route cần thêm `@AllowPartnerAccount()`. Route `DELETE /vehicle-registrations/:id` (user) ở dòng ~264-277 — route admin mới đặt cạnh nhóm `admin/...` hiện có (dòng ~111-133), theo đúng tiền lệ UC-101 (`admin/vehicle-registrations` GET đặt trước `vehicle-registrations/:id`).
- **`allow-partner-account.decorator.ts`**: `export const AllowPartnerAccount = () => SetMetadata(ALLOW_PARTNER_ACCOUNT_KEY, true)` — decorator không tham số, gắn thẳng lên method.
- **Permission seed mẫu** ([20260722000006-SeedAnprVehicleAdminReadPermission.ts](../../../../src/database/migrations/20260722000006-SeedAnprVehicleAdminReadPermission.ts)): pattern chuẩn — `INSERT INTO permissions (...) ON CONFLICT (permission_code) DO NOTHING RETURNING id`, fallback SELECT nếu đã tồn tại, rồi loop `INSERT INTO role_permissions ... ON CONFLICT DO NOTHING` cho 2 role `SYSTEM_ADMIN`+`BUSINESS_ADMIN`. `down()` xoá `role_permissions` rồi `permissions` theo `permission_code`. **Tái dùng nguyên pattern này cho `admin_delete`** — đổi `code`/`action`/`description`, giữ 2 role.
- **Migration mới nhất trong repo**: `20260812000002-GrantDepartmentDeactivateToBusinessAdmin.ts` → 2 migration mới của VPT-001 đặt tiếp `20260812000003` (index) và `20260812000004` (permission seed).
- **Test mẫu**: `vehicle-resolve.service.spec.ts` mock `dsMock.manager.query` theo `sql.includes(...)` (dòng 35-66) — nhánh `sql.includes('FROM vehicle_registrations')` cần đổi matcher vì câu SQL mới có JOIN (`FROM vehicle_registrations vr JOIN users u`) nhưng vẫn chứa substring `FROM vehicle_registrations` nên **matcher cũ vẫn khớp được, không cần đổi**, chỉ cần đổi *nội dung trả về* theo case (`over.user`) để phản ánh cột `account_expires_at ở đâu — thực chất mock chỉ cần trả đúng `{id, user_id}` hoặc `[]` tuỳ ca, không cần mock đúng cột JOIN vì mock không chạy SQL thật). `admin-vehicle-registration-response.dto.spec.ts` (65 dòng) — thêm case `account_expires_at`. `vehicle-registration.controller.spec.ts` — pattern check guard bằng `Reflect.getMetadata('__guards__', controller.method)` và permission bằng `Reflect.getMetadata(PERMISSIONS_KEY, controller.method)`; áp dụng tương tự cho `ALLOW_PARTNER_ACCOUNT_KEY`.

**AC RECON**: 8 mục trên đã đối chiếu khớp code thật tại thời điểm viết plan — đủ điều kiện sang T1 (tasks.md).

---

## 1. Quyết định đã chốt (mirror spec §6, KHÔNG mở lại)

1. Permission xoá hộ: **`anpr.vehicle.admin_delete`** (mới, 2 role `SYSTEM_ADMIN`+`BUSINESS_ADMIN`, mirror `admin_read`).
2. `account_expires_at`: **top-level** trong `AdminVehicleRegistrationResponseDto`, sửa comment SEC-01.
3. VPT-BE-04: **KHÔNG code** — không route `/users/:userId/vehicles`.
4. `resolveUserByPlate()`: JOIN `users`, điều kiện `(u.account_expires_at IS NULL OR u.account_expires_at >= NOW())` **VÀ** `u.deleted_at IS NULL`.

Constitution áp dụng (mirror spec §4): **SEC-01** (owner boundary có ngoại lệ tường minh), **SEC-02** (route DELETE admin gate `admin_delete`), **SEC-03** (JOIN mới giữ bind-param, điều kiện literal SQL không nhận input), **DATA-01** (soft-delete, không hard-delete), **ARCH-01** (không cross-module call mới), **ARCH-03** (DELETE idempotent), **ENG-01** (test ≥80% nhánh mới).

---

## 2. Thiết kế theo hạng mục

### 2.1. `resolveUserByPlate()` — sửa (VPT-BE-01 + quyết định 4)

`src/modules/anpr/services/vehicle-resolve.service.ts`, method `resolveUserByPlate()` (dòng 468-479 hiện tại):

```ts
private async resolveUserByPlate(
  plateNumber: string,
): Promise<ResolvedVehicle | null> {
  const rows: UserRow[] = await this.dataSource.manager.query(
    `SELECT vr.id, vr.user_id FROM vehicle_registrations vr
     JOIN users u ON u.id = vr.user_id
     WHERE vr.plate_number = $1 AND vr.status = 'active' AND vr.deleted_at IS NULL
       AND u.deleted_at IS NULL
       AND (u.account_expires_at IS NULL OR u.account_expires_at >= NOW())
     LIMIT 1`,
    [plateNumber],
  );
  if (!rows[0]) return null;
  return { userId: rows[0].user_id, vehicleRegistrationId: rows[0].id };
}
```

- **KHÔNG đổi** `UserRow`/`ResolvedVehicle` interface (dòng 24-39), **KHÔNG đổi** chữ ký method, **KHÔNG đổi** call site ([:108](../../../../src/modules/anpr/services/vehicle-resolve.service.ts) `resolveUserByPlate(evt.plateNumber)`).
- Cập nhật JSDoc method (dòng 464-467 hiện tại) — thêm 1 dòng nêu rõ điều kiện hết hạn/xoá tài khoản (mirror style comment `OQ-1`/`QC-7` đã có trong file).
- **KHÔNG đổi** phần còn lại của `onVehicleEvent()` — `matchState`/`processedStatus`/payload logic giữ nguyên 100% (khi `resolveUserByPlate()` trả `null`, luồng downstream tự động xử lý y hệt "biển lạ" hiện có — đúng R1/R2 spec).

### 2.2. Migration index (VPT-BE-02)

File mới `src/database/migrations/20260812000003-AddIndexUsersAccountExpiresAt.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndexUsersAccountExpiresAt20260812000003
  implements MigrationInterface
{
  name = 'AddIndexUsersAccountExpiresAt20260812000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_users_account_expires_at
         ON users (account_expires_at)
         WHERE account_expires_at IS NOT NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_account_expires_at;`);
  }
}
```

### 2.3. Test — `vehicle-resolve.service.spec.ts` (VPT-BE-03)

Thêm vào `describe('resolveUserByPlate ...')` (tạo mới nếu chưa có describe riêng cho private method — test hiện tại gọi qua `onVehicleEvent()` public, xem `wire()` helper dòng 23-67):

- **case hết hạn**: `wire({ user: [] })` (mock trả rỗng — vì mock không chạy SQL thật, việc "hết hạn" được mô phỏng bằng cách để `over.user` rỗng, đúng cách file test hiện tại đã mô phỏng "biển không có/disabled") → `onVehicleEvent(evt())` → `payloadOf().userId` = `null`, `payloadOf().matchState` = `'unmatched'`, `insert().params[3]` (processed_status) = `'unmatched'`.
- **case `account_expires_at = null`**: `wire({ user: [{ id: 'reg1', user_id: 'u1' }] })` (mirror default hiện có) → `payloadOf().userId` = `'u1'`, `matchState` = `'matched'`.
- **case đã gia hạn**: cùng mock case 2 (mock không phân biệt được giá trị cột JOIN — chỉ assert hành vi khi resolve trả có/không có row, đúng với cách unit test hiện tại chỉ mock kết quả cuối cùng của câu query, không mock schema).
- **Ghi chú quan trọng**: vì `resolveUserByPlate()` gọi `dataSource.manager.query` với 1 câu SQL duy nhất (không tách 2 query), test đơn vị **không thể** phân biệt "hết hạn" vs "không tồn tại" ở tầng mock (cả 2 đều là `wire({ user: [] })`) — đây là **giới hạn chấp nhận được của unit test raw-SQL** (đã mirror cách file test hiện tại xử lý case "biển disabled" tương tự, xem T1b tasks.md). Muốn test SQL thật cần integration test (ngoài scope VPT-001, xem Residuals spec §8).

### 2.4. `@AllowPartnerAccount()` (VPT-BE-07)

`src/modules/anpr/controllers/vehicle-registration.controller.ts`:
- Thêm import: `import { AllowPartnerAccount } from '../../../common/decorators/allow-partner-account.decorator.js';`
- Gắn `@AllowPartnerAccount()` lên `historyOwn()` (ngay trên/dưới `@UseGuards(JwtAuthGuard)`, dòng ~60) và `list()` (dòng ~139).
- **KHÔNG** gắn cho `historyAll()`, `listAll()`, `registerForUser()`, hay route `DELETE` admin mới (2.5) — các route admin không dành cho đối tác.

### 2.5. Route `DELETE /anpr/admin/vehicle-registrations/:id` (VPT-BE-05)

**Service** — `src/modules/anpr/services/vehicle-registration.service.ts`, thêm method mới (đặt cạnh `softDeleteOwned`, dòng ~263):

```ts
/** Admin xoá-mềm bất kỳ xe nào — KHÔNG fold userId (khác softDeleteOwned). */
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

**Controller** — thêm route trong nhóm admin (đặt sau `POST admin/vehicle-registrations` dòng ~215, trước nhóm UC2 route user):

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

- **Thứ tự khai**: đặt route này **trước** `@Delete('vehicle-registrations/:id')` (route user, hiện ở dòng ~264) trong file — mirror tiền lệ UC-101 (`admin/vehicle-registrations` GET đặt trước `vehicle-registrations/:id` GET), dù về kỹ thuật không bắt buộc (prefix literal `admin` khác `vehicle-registrations`).

### 2.6. Migration seed permission `anpr.vehicle.admin_delete`

File mới `src/database/migrations/20260812000004-SeedAnprVehicleAdminDeletePermission.ts` — copy nguyên cấu trúc `20260722000006-SeedAnprVehicleAdminReadPermission.ts` (§0), đổi:

```ts
private readonly permission = {
  code: 'anpr.vehicle.admin_delete',
  name: 'Admin xoa ho bien so xe',
  module: 'anpr',
  action: 'admin_delete',
  description: 'Cho phep admin xoa mem bien so xe cua bat ky user nao (khong can la chu xe)',
};
private readonly roles = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN']; // giống admin_read/admin_register
```
Toàn bộ `up()`/`down()` **giữ nguyên logic** của file mẫu (chỉ đổi field trên).

### 2.7. `AdminVehicleRegistrationResponseDto` (VPT-BE-06)

`src/modules/anpr/dto/admin-vehicle-registration-response.dto.ts`:

```ts
export interface AdminVehicleRegistrationResponseDto extends VehicleRegistrationResponseDto {
  owner: AdminVehicleOwner | null;
  account_expires_at: string | null;
}

export function toAdminVehicleRegistrationResponse(
  entity: VehicleRegistrationEntity,
): AdminVehicleRegistrationResponseDto {
  return {
    ...toVehicleRegistrationResponse(entity),
    owner: entity.user
      ? { user_id: entity.user.id, full_name: entity.user.fullName, email: entity.user.email }
      : null,
    account_expires_at: entity.user?.accountExpiresAt?.toISOString() ?? null,
  };
}
```
- Sửa comment JSDoc phía trên `AdminVehicleOwner` (dòng 7-13 hiện tại) — thêm câu: *"`account_expires_at` (VPT-001) là ngoại lệ có chủ đích nằm ngoài khối `owner` — không phải nới lỏng quy tắc trên, chỉ phục vụ hiển thị hạn tài khoản đối tác, route đã gate `admin_read`."*
- **KHÔNG** cần sửa `vehicle-registration.service.ts::listAll()` — đã `leftJoinAndSelect('vr.user','u')` sẵn (§0).

---

## 3. File list

### Net-new (4)
- `src/database/migrations/20260812000003-AddIndexUsersAccountExpiresAt.ts`
- `src/database/migrations/20260812000004-SeedAnprVehicleAdminDeletePermission.ts`
- (không có file service/controller net-new — mọi thứ modify file có sẵn)

### Modified (6)
- `src/modules/anpr/services/vehicle-resolve.service.ts` — sửa `resolveUserByPlate()` (2.1)
- `src/modules/anpr/services/vehicle-resolve.service.spec.ts` — thêm 2-3 case (2.3)
- `src/modules/anpr/controllers/vehicle-registration.controller.ts` — `@AllowPartnerAccount()` ×2 (2.4) + route `DELETE` admin mới (2.5)
- `src/modules/anpr/controllers/vehicle-registration.controller.spec.ts` — test guard mới cho 2.4 + 2.5
- `src/modules/anpr/services/vehicle-registration.service.ts` — thêm `adminSoftDelete()` (2.5)
- `src/modules/anpr/services/vehicle-registration.service.spec.ts` — test `adminSoftDelete()`
- `src/modules/anpr/dto/admin-vehicle-registration-response.dto.ts` — field + comment (2.7)
- `src/modules/anpr/dto/admin-vehicle-registration-response.dto.spec.ts` — test field mới (2.7)

> Tổng **2 net-new (migration) + 8 modified**. 0 net-new service/controller file. 0 đổi env.

---

## 4. Test plan (tổng hợp §2.3/2.4/2.5/2.7 — chi tiết ở tasks.md)

- `resolveUserByPlate()`: 3 case (hết hạn/xoá tài khoản → unmatched · `account_expires_at=null` → matched như cũ · đã gia hạn → matched) + xác nhận `onVehicleEvent()` UC1-8 không hồi quy (`npx jest src/modules/anpr` xanh).
- `@AllowPartnerAccount()`: assert metadata `ALLOW_PARTNER_ACCOUNT_KEY = true` trên `historyOwn`/`list`; assert **KHÔNG** có trên `historyAll`/`listAll`/`registerForUser`/route DELETE admin mới.
- `adminSoftDelete()`: xoá thành công (fold KHÔNG userId) · xoá id không tồn tại/đã xoá → `NotFoundException` code `VEHICLE_NOT_FOUND_OR_FORBIDDEN`.
- Route `DELETE` admin: guard = `JwtAuthGuard`+`PermissionsGuard`; permission = `['anpr.vehicle.admin_delete']`; response envelope `{success:true, message, data:null}`.
- `toAdminVehicleRegistrationResponse()`: `account_expires_at` map đúng từ `entity.user.accountExpiresAt` (có giá trị / `null` / `entity.user` null → `null`, không nổ).
- Coverage ≥80% cho `resolveUserByPlate` (nhánh mới), `adminSoftDelete`, mapper.

---

## 5. Gate (STOP, KHÔNG commit)

- build=0; eslint touched (8 file modified + 2 migration mới) baseline-proof **0 rule mới**; `npx jest src/modules/anpr` xanh (toàn bộ UC1-9/UC-101 KHÔNG hồi quy + case mới VPT-001); coverage ≥80% cho code mới; DI-proof compile `AppModule` (0 circular/UnknownDependencies).
- Migration chạy thử (nếu có DB dev khả dụng) — **KHÔNG chạy lên RDS chung** trong phạm vi plan/tasks này (theo đúng nguyên tắc CLAUDE.md §5.5 — chỉ Thiếu Chủ/quy trình release quyết định áp migration lên RDS chung).
- **Owed runbook (ghi, KHÔNG chạy)**: OQ-3 (spec §7) — xác nhận với đội phần cứng việc mở cổng vật lý có tra `matched`/`unmatched` từ BE hay không, trước khi công bố kết quả demo phần cứng.

## 6. Kỷ luật

- **No new module/entity/table** — toàn bộ thay đổi nằm trong `anpr` module (service/controller/dto có sẵn) + 2 migration (index + permission seed).
- **KHÔNG đụng** `VehicleControlAlertService`, `login.service.ts`/`refresh-token.service.ts`, `PATCH /users/:id` (đã đủ dùng từ PTA-001).
- **KHÔNG** tạo route `/users/:userId/vehicles` (quyết định 3, §6 spec).
- Mọi migration mới theo đúng pattern seed permission đã có (§0) — **KHÔNG** dùng raw SQL ngoài migration.
- Nếu sửa eslint: đọc lại file sau khi sửa, KHÔNG sed/regex hàng loạt làm rỗng assertion (CLAUDE.md Markdown/coding safety rules).

---

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan → sang `tasks.md`. KHÔNG code, KHÔNG migration, KHÔNG chạy test/build, KHÔNG commit.
