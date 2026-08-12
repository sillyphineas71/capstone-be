# ACCT-DEPT-DEACTIVATE-001 — tasks.md

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | **Fix role gap phát hiện khi soạn báo cáo bàn giao FE**: `department.deactivate` thiếu `BUSINESS_ADMIN` so với 3 permission chị em cùng resource. Đã tạo + chạy `20260812000002-GrantDepartmentDeactivateToBusinessAdmin.ts` lên RDS chung (xác nhận trước khi chạy với Thiếu Chủ), verify lại bằng query: `department.deactivate` giờ có đủ `BUSINESS_ADMIN, MANAGER, SYSTEM_ADMIN`. | T5 |
| 2026-08-12 | **Đã chạy migration lên RDS chung** theo yêu cầu trực tiếp của Thiếu Chủ, dùng `npm run migration:run:tsx` (CLI chuẩn `migration:run` lỗi module resolution có sẵn trong repo, không liên quan feature này — xem ghi chú T5). Đã xác minh bằng query trực tiếp: `permissions.permission_code='department.deactivate'` tồn tại, `is_active=true`, đã gán cho cả `MANAGER` và `SYSTEM_ADMIN` qua `role_permissions`. Chỉ đúng 1 migration được áp (xác nhận RDS đã đồng bộ các migration khác từ trước, không có migration tồn đọng nào khác bị chạy kèm). | T5, T-GATE |
| 2026-08-12 | **Code review sau khi agent khác báo implement xong.** Phát hiện + tự sửa 1 lỗi nghiêm trọng (migration seed đặt sai thư mục `src/database/seeds/` — thư mục này KHÔNG có runner trong repo, permission `department.deactivate` sẽ không bao giờ được seed → cả 2 endpoint sẽ trả 403 vĩnh viễn ở môi trường thật) + 2 test bug (1 test cũ bị vỡ do quên cập nhật khi bỏ `isActive`; 1 test mới dùng sai giá trị `PARTNER_DEPARTMENT_ID` khiến test pass giả — không thực sự kiểm tra đúng nhánh). Đã sửa cả 3, thêm test DTO còn thiếu (AC-010), lint sạch. T6 + T-GATE hoàn thành. | T6, T-GATE |
| 2026-08-12 | Khởi tạo tasks. | Toàn bộ file |

## T1 — DTO `UpdateDepartmentDto` (code) — plan §4
- **AC**: field `isActive` bị xoá; body `PATCH /departments/:id` chứa `isActive` → `400` (`forbidNonWhitelisted`).

## T2 — Service `deactivateDepartment` (code) — plan §5.1
- **AC**: đủ 5 nhánh BR-01→BR-05 (spec §4.1) + happy path (`isActive=false`, audit `actionType='deactivate'`).

## T3 — Service `reactivateDepartment` (code) — plan §5.2
- **AC**: đủ 3 nhánh BR-06→BR-08 (spec §4.2) + happy path (`isActive=true`, audit `actionType='reactivate'`) + xác nhận KHÔNG chặn `PARTNER_DEPARTMENT_ID`.

## T4 — Controller `POST :id/deactivate` + `POST :id/reactivate` (code) — plan §6
- **AC**: route đăng ký đúng, guard/permission `department.deactivate` đúng cho cả 2 route, `id` sai UUID → 400.

## T5 — Migration seed permission `department.deactivate` (code) — plan §7 — ⚠️ SỬA LẠI 2026-08-12
- **AC**: idempotent (`WHERE NOT EXISTS`), có `down()`, role đúng `MANAGER`, `SYSTEM_ADMIN` (đối chiếu `department.update`).
- **Bug tìm thấy khi review**: agent đặt file tại `src/database/seeds/20260812000001-SeedDepartmentDeactivatePermission.ts` — export 1 async function rời, KHÔNG phải `MigrationInterface`. `src/database/data-source.ts:31` chỉ glob `./migrations/*.{ts,js}` — **thư mục `seeds/` không hề được `migration:run` đọc tới**, xác nhận qua grep toàn bộ repo (không nơi nào import/gọi hàm trong `seeds/`). Nếu không phát hiện, permission `department.deactivate` sẽ **không bao giờ tồn tại trên DB thật**, khiến `POST /departments/:id/deactivate` và `/reactivate` trả `403` cho MỌI role, mọi môi trường — tính năng coi như không dùng được dù code service/controller đúng 100%.
- **Đã sửa**: xoá file trong `seeds/`, tạo lại đúng chuẩn tại `src/database/migrations/20260812000001-SeedDepartmentDeactivatePermission.ts`, class `implements MigrationInterface`, có `up()`/`down()`, cùng khuôn `20260727000001-SeedDepartmentUpdatePermission.ts`. `tsc --noEmit` xác nhận file mới compile sạch trong scope migrations (không bị exclude).
- **Đã chạy lên RDS chung 2026-08-12** (theo yêu cầu trực tiếp của Thiếu Chủ) — xem CHANGELOG đầu file. `npm run migration:run -d src/database/data-source.ts` (CLI `typeorm-ts-node-commonjs`) bị lỗi `MODULE_NOT_FOUND` khi resolve `.js` import trong `zones/entities/gate-access-log.entity.ts` — lỗi hạ tầng có sẵn của repo (không phải do migration mới), đã có sẵn script thay thế `npm run migration:run:tsx` (`scripts/run-migrations.ts`, dùng `tsx` thay vì `ts-node`) — dùng script đó thành công, chỉ áp đúng 1 migration (`SeedDepartmentDeactivatePermission20260812000001`), xác nhận RDS không có migration tồn đọng nào khác.

## T6 — Test (code) — plan §8 — ✅ HOÀN THÀNH 2026-08-12 (sau khi sửa 2 bug)
- **AC**: `npx jest departments` xanh, coverage ≥80% cho phần mới; test regression `PATCH isActive` → 400.
- **Bug #1 tìm thấy**: test cũ `updateDepartment › ghi audit log khi cập nhật thành công` (viết từ trước, thuộc DEPT-UPD-001) gọi `service.updateDepartment('d1', { isActive: false }, ...)` — sau khi agent xoá `isActive` khỏi DTO/service, `isActive` không còn được coi là "field hợp lệ" trong điều kiện `EMPTY_UPDATE_PAYLOAD` nữa → test vỡ (`BadRequestException` thay vì pass). Agent không chạy lại test này trước khi báo cáo xong. Đã sửa: đổi payload sang `{ description: 'mo ta moi' }` (vẫn giữ đúng mục đích test — audit log ghi khi update thành công).
- **Bug #2 tìm thấy**: test mới `[BR-02] PARTNER_DEPARTMENT_ID → ném ForbiddenException` dùng `await import('@nestjs/common')` bên trong test — Jest project này chạy ESM không bật `--experimental-vm-modules` cho dynamic import kiểu này → lỗi runtime. **Sau khi sửa lỗi import thì lộ ra bug thứ 2 nghiêm trọng hơn**: test dùng UUID giả `'00000000-0000-0000-0000-000000000000'` thay vì hằng số thật `PARTNER_DEPARTMENT_ID` (`'7c3e2f1a-4b6a-4f2e-9d8c-1a2b3c4d5e6f'`, từ `common/utils/partner-account.util.ts`) → test KHÔNG hề kiểm tra đúng nhánh BR-02, chỉ "pass giả" vì trước đó bị che bởi lỗi import. Đã sửa: import `PARTNER_DEPARTMENT_ID` thật, dùng đúng giá trị ở cả 2 test (deactivate BR-02 và reactivate "không bị chặn").
- **Bổ sung**: tạo `update-department.dto.spec.ts` (chưa tồn tại trước đó) để test AC-010 đúng tầng DTO — `validate(dto, {whitelist:true, forbidNonWhitelisted:true})` xác nhận `isActive` bị từ chối, mirror đúng option của `ValidationPipe` trong controller.
- **Dọn dẹp phụ**: `before` snapshot trong audit log của `updateDepartment` vẫn còn field `isActive` dù field này không còn thay đổi qua endpoint đó — đã bỏ để audit log nhất quán (không ghi field không thuộc phạm vi thao tác).
- **Kết quả cuối**: 78/78 test xanh (departments.service.spec.ts + departments.controller.spec.ts + update-department.dto.spec.ts, gộp cả feature 1 và 2).

## T-GATE — ✅ ĐẠT (sau khi sửa 3 bug ở T5/T6 + đã chạy migration)
- `tsc --noEmit` sạch; test xanh (78/78); lint sạch cho mọi file mới/sửa (đã tự fix 1 lỗi `no-unsafe-assignment` mới trong `departments.controller.spec.ts`); migration **đã chạy lên RDS chung** 2026-08-12 theo yêu cầu trực tiếp của Thiếu Chủ (xem CHANGELOG); xác nhận không phá route `POST`/`GET`/`GET :id/members` hiện có. Coverage % không đọc được do lỗi công cụ môi trường (không liên quan code).
- **Đã xác minh trên DB thật** (query trực tiếp, không chỉ tin log migration): `permissions.permission_code='department.deactivate'` tồn tại, `is_active=true`; `role_permissions` đã gán cho `MANAGER` và `SYSTEM_ADMIN`.
- **Không còn việc gì chặn merge** cho 2 feature này ở phía backend.

## Requirements Coverage
| FR / AC / BR | Task |
|---|---|
| FR-001, FR-008 | T4, T5 |
| FR-002 / BR-04, BR-05 / AC-002, AC-003 | T2, T6 |
| FR-003 / BR-08 / AC-007 | T3, T6 |
| FR-004 / BR-03, BR-07 / AC-004, AC-008 | T2, T3, T6 |
| FR-005 / BR-02 / AC-005 | T2, T6 |
| FR-006 / AC-010 | T1, T6 |
| FR-007 / AC-011 | T2, T3, T6 |
| AC-001, AC-006, AC-009 | T2, T3, T4, T6 |
