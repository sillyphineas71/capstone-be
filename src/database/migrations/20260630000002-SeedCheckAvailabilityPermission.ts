import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A5 (IOT-005) — Seed idempotent permission `iot.device.check_availability`
 * (route POST /iot-devices/:id/check-availability, guard auth thật) + gán role.
 *
 * Role-set (ĐỀ XUẤT, CHỜ DUYỆT): `ADMIN`, `MANAGER` — mirror đúng role-set vận hành IoT
 * đã seed ĐỒNG NHẤT cho mọi permission iot hiện có (iot.device.read/update/probe/
 * disable/enable đều gán ['ADMIN','MANAGER']; vd SeedIotDeviceProbePermission.ts:35).
 *
 * Naming: permission_code dùng dạng DOT `iot.device.check_availability` — ĐỒNG BỘ convention
 * module iot (các permission đã seed: `iot.device.read/update/probe/disable/enable`). Chuỗi này
 * khớp chính xác `@RequirePermissions('iot.device.check_availability')` ở controller A5 (T-04) để
 * guard match đúng route.
 *
 * Đặt trong migrations/ (không phải seeds/) để chạy chắc qua `migration:run` — pattern
 * seeds/*SeedXxxPermission*.ts hiện KHÔNG có runner (mirror B21/avatar).
 *
 * Idempotent: ON CONFLICT DO NOTHING (permissions + role_permissions) + fallback SELECT id.
 * Quyền có permission CHỈ mở cửa cho role vào tới service — ràng buộc nghiệp vụ (heartbeat/probe)
 * do checkAvailability quyết, KHÔNG do permission này.
 */
export class SeedCheckAvailabilityPermission20260630000002 implements MigrationInterface {
  name = 'SeedCheckAvailabilityPermission20260630000002';

  private readonly permissionCode = 'iot.device.check_availability';
  private readonly roleCodes = ['ADMIN', 'MANAGER'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const inserted = (await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [
        this.permissionCode,
        'Kiểm tra trạng thái khả dụng của camera',
        'iot',
        'device_check_availability',
        'Cho phép chẩn đoán khả dụng camera (heartbeat Face Server / runtime RTSP probe IP Camera).',
      ],
    )) as Array<{ id: string }>;

    // ON CONFLICT DO NOTHING không trả row khi permission đã tồn tại → SELECT lại.
    let permissionId: string | undefined = inserted[0]?.id;
    if (!permissionId) {
      const existing = (await queryRunner.query(
        `SELECT id FROM permissions WHERE permission_code = $1 LIMIT 1;`,
        [this.permissionCode],
      )) as Array<{ id: string }>;
      permissionId = existing[0]?.id;
    }
    if (!permissionId) {
      return;
    }

    for (const roleCode of this.roleCodes) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, $2, NOW()
         FROM roles r
         WHERE r.role_code = $1 AND r.is_active = true
         ON CONFLICT (role_id, permission_id) DO NOTHING;`,
        [roleCode, permissionId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (
         SELECT id FROM permissions WHERE permission_code = $1
       );`,
      [this.permissionCode],
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code = $1;`,
      [this.permissionCode],
    );
  }
}
