import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BA đổi nghiệp vụ (2026-08-03): duyệt sinh trắc học chuyển từ MANAGER sang
 * BUSINESS_ADMIN. MANAGER bị thu hồi hoàn toàn quyền này; SYSTEM_ADMIN giữ nguyên
 * (không đổi). Xem admin-biometric-review.controller.ts (@RequireRoles).
 */
export class TransferBiometricReviewToBusinessAdmin20260803000002 implements MigrationInterface {
  name = 'TransferBiometricReviewToBusinessAdmin20260803000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissionCodes = [
      'account.biometric.review',
      'account.biometric.download',
    ];

    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE role_id IN (SELECT id FROM roles WHERE role_code = $1)
         AND permission_id IN (SELECT id FROM permissions WHERE permission_code IN ($2, $3));`,
      ['MANAGER', ...permissionCodes],
    );

    for (const code of permissionCodes) {
      await queryRunner.query(
        'INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, p.id, NOW() FROM roles r, permissions p WHERE r.role_code = $1 AND r.is_active = true AND p.permission_code = $2 ON CONFLICT (role_id, permission_id) DO NOTHING;',
        ['BUSINESS_ADMIN', code],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const permissionCodes = [
      'account.biometric.review',
      'account.biometric.download',
    ];

    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE role_id IN (SELECT id FROM roles WHERE role_code = $1)
         AND permission_id IN (SELECT id FROM permissions WHERE permission_code IN ($2, $3));`,
      ['BUSINESS_ADMIN', ...permissionCodes],
    );

    for (const code of permissionCodes) {
      await queryRunner.query(
        'INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, p.id, NOW() FROM roles r, permissions p WHERE r.role_code = $1 AND r.is_active = true AND p.permission_code = $2 ON CONFLICT (role_id, permission_id) DO NOTHING;',
        ['MANAGER', code],
      );
    }
  }
}
