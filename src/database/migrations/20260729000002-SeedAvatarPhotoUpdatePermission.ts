import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * feat-split-avatar-and-biometric (T02): seed permission mới cho luồng avatar
 * hiển thị tự do (không cần duyệt) — tách biệt hoàn toàn khỏi permission
 * sinh trắc học (profile.biometric.*). Idempotent theo đúng pattern các
 * migration permission trước đó (ON CONFLICT DO NOTHING + fallback SELECT).
 *
 * Ghi chú role: bảng `roles` thực tế dùng role_code = 'EMPLOYEE' cho vai trò
 * nhân viên thường (không phải 'INTERNAL_USER') — khớp
 * 20260624000002-SeedProfileAvatarPermissions.ts.
 *
 * Xem spec/features/account/feat-split-avatar-and-biometric/plan.md §3.2.
 */
export class SeedAvatarPhotoUpdatePermission20260729000002 implements MigrationInterface {
  name = 'SeedAvatarPhotoUpdatePermission20260729000002';

  private readonly permission = {
    code: 'profile.avatar.update',
    name: 'Tự cập nhật ảnh đại diện (không cần duyệt)',
    action: 'avatar_update',
    description:
      'Cho phép user tự upload/thay ảnh đại diện của chính mình, hiệu lực ngay lập tức, không qua bước duyệt',
  };

  private readonly roles = [
    'EMPLOYEE',
    'MANAGER',
    'BUSINESS_ADMIN',
    'SYSTEM_ADMIN',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const inserted: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, 'accounts', $3, $4, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [
        this.permission.code,
        this.permission.name,
        this.permission.action,
        this.permission.description,
      ],
    );

    let permissionId: string | undefined = inserted[0]?.id;
    if (!permissionId) {
      const existing: Array<{ id: string }> = await queryRunner.query(
        `SELECT id FROM permissions WHERE permission_code = $1 LIMIT 1;`,
        [this.permission.code],
      );
      permissionId = existing[0]?.id;
    }
    if (!permissionId) {
      return;
    }

    for (const roleCode of this.roles) {
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
      [this.permission.code],
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code = $1;`,
      [this.permission.code],
    );
  }
}
