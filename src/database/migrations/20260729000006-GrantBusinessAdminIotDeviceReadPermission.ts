import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * IOT-GAP-01 — grant permission `iot.device.read` (đã tồn tại) cho role BUSINESS_ADMIN.
 * Mirror 20260727000006-GrantManagerAvatarReviewPermission.ts — permission KHÔNG mới, chỉ
 * thêm 1 dòng role_permissions. KHÔNG mở rộng sang iot.device.disable/enable/probe/update.
 */
export class GrantBusinessAdminIotDeviceReadPermission20260729000006 implements MigrationInterface {
  name = 'GrantBusinessAdminIotDeviceReadPermission20260729000006';

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
