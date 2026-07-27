# SCFG-001 — tasks.md (BE-09: GET/PATCH /system-configurations)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-27 | Tạo tasks, code xong cùng lượt. | Toàn bộ |

## T1 — Allowlist (code) — plan §2
- **AC**: 9 entry đúng key/valueType/min/max/default khớp `SystemSettings.jsx:28-38`.

## T2 — DTO (code) — plan (file list)
- **AC**: `UpdateSystemConfigDto` `@IsIn(allowlist keys)`; `SystemConfigResponseDto` field `key`/`value` (không phải `configKey`/`configValue`).

## T3 — Service `SystemConfigService` (code) — plan §3
- **AC**: đủ nhánh R1→R8 ở spec §5; KHÔNG `ON CONFLICT`.

## T4 — Controller (code) — plan §4
- **AC**: route đăng ký đúng; permission `admin.manage_config`.

## T5 — Module wiring (code)
- **AC**: `administration.module.ts` đăng ký controller + provider.

## T6 — Migration (code) — plan §5
- **AC**: 2 migration idempotent, `down()` đầy đủ, role đúng chỉ `SYSTEM_ADMIN` cho permission.

## T7 — Test (code) — plan §6
- **AC**: `npx jest system-config` 14/14 xanh; coverage 100%/86.36% (≥80%).

## T-GATE
- `tsc --noEmit` sạch; test xanh; coverage đạt; KHÔNG chạy migration lên RDS chung (chờ review).
