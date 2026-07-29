# IOT-GAP-01 — plan.md (Bổ sung quyền BUSINESS_ADMIN cho `iot.device.read`)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-29 | Tạo plan cùng lượt với spec. 1 migration duy nhất, KHÔNG DDL, KHÔNG code module. | Toàn bộ |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2.

## 0. RECON bổ sung
- Xác nhận permission `iot.device.read` đã tồn tại trong bảng `permissions` (được tạo bởi migration backfill `20260720000005`) — migration mới ở đây CHỈ cần `INSERT INTO role_permissions`, KHÔNG cần `INSERT INTO permissions`.
- Xác nhận role `BUSINESS_ADMIN` đã tồn tại trong bảng `roles` với `role_code='BUSINESS_ADMIN'` (đã dùng nhiều nơi khác trong repo, ví dụ các migration Seed... khác của campus-dashboard).
- Xác nhận timestamp migration tiếp theo còn trống trước khi tạo file thật (T0).

## 1. Quyết định đã chốt (từ spec §1/§2)
Chỉ `.read`, mirror pattern `GrantManagerAvatarReviewPermission.ts` (JOIN trực tiếp, không tách bước SELECT permission id).

## 2. Entity — không đổi
0 thay đổi entity/schema.

## 3. Module — không tạo/sửa module nào
Route/controller/service/DTO của `iot-devices.controller.ts` giữ nguyên 100%.

## 4-8. (Repository/Service/Pure functions/DTO/Controller — N/A)
Không áp dụng cho feature này (thuần seed permission).

## 9. Migration mới
```
src/database/migrations/<TIMESTAMP>-GrantBusinessAdminIotDeviceReadPermission.ts
```
Nội dung (mirror chính xác `20260727000006-GrantManagerAvatarReviewPermission.ts`, chỉ đổi role + permission code):
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrantBusinessAdminIotDeviceReadPermission<TIMESTAMP>
  implements MigrationInterface
{
  name = 'GrantBusinessAdminIotDeviceReadPermission<TIMESTAMP>';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, p.id, NOW() FROM roles r, permissions p WHERE r.role_code = $1 AND r.is_active = true AND p.permission_code = $2 ON CONFLICT (role_id, permission_id) DO NOTHING;',
      ['BUSINESS_ADMIN', 'iot.device.read'],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE role_code = $1) AND permission_id IN (SELECT id FROM permissions WHERE permission_code = $2);',
      ['BUSINESS_ADMIN', 'iot.device.read'],
    );
  }
}
```
`<TIMESTAMP>`: xác nhận số thật ở T0 (dự kiến `20260729000006`, kiểm tra lại `ls src/database/migrations | sort | tail` ngay trước khi tạo file — có thể lệch nếu có commit khác chen giữa).

## 10. File list
### Net-new (1 file)
- `src/database/migrations/<TIMESTAMP>-GrantBusinessAdminIotDeviceReadPermission.ts`
### Modified
Không có file nào khác bị sửa.

## 11. Test
Không cần unit test riêng (migration thuần SQL, không có logic TypeScript để test) — verify bằng cách chạy migration + login BUSINESS_ADMIN + gọi `GET /iot-devices` xác nhận `200` (xem tasks.md T2).

## 12. Gate (STOP, KHÔNG commit)
- Migration file hợp lệ cú pháp TypeORM (build không lỗi).
- KHÔNG chạy migration thật ở bước code — chờ Thiếu Chủ duyệt trước khi áp lên RDS chung (mirror kỷ luật CDB-RS-001).

## 13. Kỷ luật
- **DATA-01**: chỉ ghi `role_permissions`.
- KHÔNG sửa `iot-devices.controller.ts`/service/DTO.
- KHÔNG mở rộng sang `.disable/.enable/.probe/.update`.

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md. KHÔNG tự code.
