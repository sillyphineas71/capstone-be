# SCFG-001 — plan.md (BE-09: GET/PATCH /system-configurations)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-27 | Tạo plan cùng lượt với spec + code. | Toàn bộ |

> Spec: [spec.md](./spec.md). Module `administration` đã tồn tại (`AuditLogsController`, `BackgroundJobsController`) — thêm controller/service mới, KHÔNG tạo module mới, KHÔNG entity mới (dùng lại `SystemConfigEntity` có sẵn).

## 1. File

```
src/modules/administration/constants/system-config-allowlist.ts   (mới)
src/modules/administration/dto/update-system-config.dto.ts        (mới)
src/modules/administration/dto/system-config-response.dto.ts      (mới)
src/modules/administration/services/system-config.service.ts      (mới, + .spec.ts)
src/modules/administration/controllers/system-config.controller.ts (mới)
src/modules/administration/administration.module.ts               (sửa — đăng ký controller/provider)
src/database/migrations/20260727000003-SeedSystemConfigManagePermission.ts (mới)
src/database/migrations/20260727000004-SeedDefaultSystemConfigs.ts         (mới)
```

## 2. Allowlist

`SYSTEM_CONFIG_ALLOWLIST` — mảng 9 entry `{key, valueType, configGroup, description, min?, max?, defaultValue}`. `findAllowlistEntry(key)` tra cứu O(n) (9 phần tử, không cần Map). Xem spec §2 cho ranh giới với 5 key hệ chấm.

## 3. Service — `SystemConfigService`

- `list()`: `repo.find({where: {isActive: true}})`, filter theo allowlist, map sang response (mask nếu `is_sensitive`).
- `upsert(key, value, userId)`:
  1. `findAllowlistEntry(key)` → không có → `400 CONFIG_KEY_NOT_ALLOWED`.
  2. `validateValue(entry, value)` — boolean: `value === 'true' || value === 'false'`; number: `Number(value)` hợp lệ + trong `[min, max]`.
  3. Transaction: `em.createQueryBuilder(SystemConfigEntity, 'c').where('c.configKey = :key').setLock('pessimistic_write').getMany()`.
  4. `rows.length > 1` → log warning, chọn dòng `updatedAt` lớn nhất làm target.
  5. Có target → UPDATE (`versionNo++`, `updatedBy`); không có → INSERT (`versionNo=1`).
  6. Audit log `system_config_update` (best-effort qua `AuditLogsService.logAction`, không rollback nếu audit lỗi — theo cơ chế `AUDIT_LOG_FAIL_SAFE` sẵn có của `AuditLogsService`).

## 4. Controller — `SystemConfigController`

`@Controller('system-configurations')`, class-level `@RequirePermissions('admin.manage_config')`. `GET()` → `list()`. `PATCH()` body `UpdateSystemConfigDto` → `upsert(dto.key, dto.value, user?.userId)`.

## 5. Migration

- `20260727000003-SeedSystemConfigManagePermission.ts` — `admin.manage_config`, role **CHỈ `SYSTEM_ADMIN`** (khác `department.update`/`meeting.read.all` có cả `BUSINESS_ADMIN` — màn `SystemSettings.jsx` nằm trong `systemAdmin/`, không phải `businessAdmin/`).
- `20260727000004-SeedDefaultSystemConfigs.ts` — 9 giá trị mặc định đúng `SystemSettings.jsx:28-38`. Idempotent `WHERE NOT EXISTS`, KHÔNG `ON CONFLICT` (xem spec §3.1).

## 6. Test (mock `DataSource`/`EntityManager` — KHÔNG DB)

`system-config.service.spec.ts`: `list()` filter allowlist + mask sensitive; `upsert()` — key ngoài allowlist (400), value sai kiểu boolean/number (400), ngoài min/max (400), INSERT khi chưa có, UPDATE + version_no++ khi đã có, dùng `setLock('pessimistic_write')` (không `ON CONFLICT`), xử lý đúng khi có >1 dòng trùng key (cập nhật dòng mới nhất), audit log được gọi đúng payload. 14 test, coverage 100% stmt/func/line, 86.36% branch.

## 7. Gate

`npx tsc --noEmit -p tsconfig.build.json` sạch; `npx jest system-config` xanh (14/14); coverage ≥80%; KHÔNG chạy 2 migration lên RDS chung (chờ review).
