# SRCH-01 — tasks.md (Tìm kiếm tổng hợp đa nguồn — Global Search)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-29 | Tạo tasks: T0 verify → T1 module scaffold → T2 DTO → T3 service → T4 controller → T5 wiring AppModule → T-GATE. | Toàn bộ |

> Map: spec.md, plan.md.

## Thứ tự
T0 → T1 → T2 → T3 → T4 → T5 → T-GATE.

---

## T0 — RECON-verify — plan §0
- Xác nhận path export 5 entity (`ZoneEntity`, `IoTDeviceEntity`, `VehicleRegistrationEntity`, `UserEntity`, `MeetingEntity`), `AuthzReadRepository` import path, `normalizePlate` import path.
- **AC**: dán xác nhận đủ; thiếu → **DỪNG**.

## T1 — Module `search` (scaffold) — plan §3
- `search.module.ts`, `forFeature` 5 entity, import `AuthModule`.
- **AC**: module compile độc lập (controller/service để rỗng tạm, bổ sung ở T3/T4).

## T2 — DTO (code) — plan §7
- `QuerySearchDto` (`q` `@MinLength(2)`, `types` optional), `SearchResultItemDto`/`SearchTypeResultDto`/`SearchResponseDto`.
- **AC**: `q` < 2 ký tự bị `ValidationPipe` chặn 400 (test riêng); `types` allowlist validate thủ công (không dùng decorator phức tạp).

## T3 — Service `SearchService` (code + test) — plan §5, §11
- `TYPE_PERMISSION_MAP`, `search()`, `searchByType()` (5 nhánh switch).
- **AC**: đủ test case R4/R5/R6/R7 ở plan §11; `vehicle` gọi `normalizePlate` trước ILIKE; `device` KHÔNG áp `deletedAt`.

## T4 — Controller (code + test) — plan §8
- `GET /api/v1/search`, `@UseGuards(JwtAuthGuard)` (KHÔNG `PermissionsGuard`), parse+validate `types` từ query string, gọi service, trả envelope chuẩn.
- **AC**: guard đúng CHỈ có `JwtAuthGuard` (test metadata, KHÔNG có `PermissionsGuard`/`@RequirePermissions` — đúng chủ ý spec §1.1, không phải thiếu sót); 400 khi `types` chứa giá trị lạ.

## T5 — Wiring `AppModule` — plan §10
- Đăng ký `SearchModule` vào `app.module.ts`.
- **AC**: DI-proof, không phá module khác.

## T-GATE — (STOP, KHÔNG commit) — plan §12
- build=0; eslint 0 warning mới; `npx jest src/modules/search` xanh; coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật, KHÔNG commit.
- **AC**: bảng gate đầy đủ + báo cáo: type-không-quyền bị loại đúng (R4) ✓ · type-có-quyền-0-kết-quả trả `items:[]` đúng (R5) ✓ · device không áp deletedAt (R6) ✓ · 4 type còn lại áp đúng deletedAt (R7) ✓ · validation q/types đúng (R2/R3) ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope SRCH-01
- T0 → verify RECON
- T1 → module scaffold
- T2 → DTO + validation
- T3 → service (permission-filter + query từng type)
- T4 → controller
- T5 → wiring AppModule
- T-GATE → gate + STOP
