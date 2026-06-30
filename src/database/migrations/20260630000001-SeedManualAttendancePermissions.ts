import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * UC-B21 (Điểm danh thủ công) — Seed idempotent 3 permission cho phần GHI điểm danh
 * và gán role_permissions (đã được Thiếu Chủ duyệt):
 *   - attendance.manual.create  → EMPLOYEE, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN
 *   - attendance.manual.update  → EMPLOYEE, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN
 *   - attendance.invalidate     → SYSTEM_ADMIN (chỉ System Admin)
 *
 * Đặt trong migrations/ (không phải seeds/) để chạy chắc qua `migration:run` —
 * pattern seeds/*SeedXxxPermission*.ts hiện KHÔNG có runner (mirror tiền lệ
 * 20260624000002-SeedProfileAvatarPermissions.ts).
 *
 * Lệch A (code-vs-spec): spec/tasks dùng tên role "INTERNAL_USER", nhưng bảng `roles`
 * thực tế dùng role_code = 'EMPLOYEE' cho nhân viên thường (xem migration
 * 20260624000002:13-16). Migration này dùng 'EMPLOYEE' để grant THỰC SỰ hiệu lực.
 *
 * Idempotent: ON CONFLICT DO NOTHING (permissions + role_permissions) + fallback SELECT
 * permission id khi permission đã tồn tại từ lần chạy trước (grant role vẫn áp dụng khi
 * chạy lại). Quyền ghi permission ≠ quyền sở hữu: ràng buộc "đúng host của đúng meeting"
 * do ownership-check tầng service quyết, KHÔNG do permission này.
 */
export class SeedManualAttendancePermissions20260630000001 implements MigrationInterface {
  name = 'SeedManualAttendancePermissions20260630000001';

  private readonly hostBaseRoles = [
    'EMPLOYEE',
    'MANAGER',
    'BUSINESS_ADMIN',
    'SYSTEM_ADMIN',
  ];

  private readonly permissions = [
    {
      code: 'attendance.manual.create',
      name: 'Tạo bản ghi điểm danh thủ công',
      action: 'manual.create',
      description:
        'Cho phép tạo bản ghi điểm danh thủ công cho participant của cuộc họp',
      roleCodes: this.hostBaseRoles,
    },
    {
      code: 'attendance.manual.update',
      name: 'Cập nhật bản ghi điểm danh thủ công',
      action: 'manual.update',
      description:
        'Cho phép cập nhật trạng thái/hồ sơ bản ghi điểm danh thủ công',
      roleCodes: this.hostBaseRoles,
    },
    {
      code: 'attendance.invalidate',
      name: 'Vô hiệu hóa bản ghi điểm danh',
      action: 'invalidate',
      description:
        'Cho phép vô hiệu hóa (invalidate) bản ghi điểm danh — chỉ System Admin',
      roleCodes: ['SYSTEM_ADMIN'],
    },
  ];

  private readonly moduleCode = 'attendance';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const permission of this.permissions) {
      const inserted = (await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (permission_code) DO NOTHING
         RETURNING id;`,
        [
          permission.code,
          permission.name,
          this.moduleCode,
          permission.action,
          permission.description,
        ],
      )) as Array<{ id: string }>;

      // ON CONFLICT DO NOTHING không trả row khi permission đã tồn tại → SELECT lại.
      let permissionId: string | undefined = inserted[0]?.id;
      if (!permissionId) {
        const existing = (await queryRunner.query(
          `SELECT id FROM permissions WHERE permission_code = $1 LIMIT 1;`,
          [permission.code],
        )) as Array<{ id: string }>;
        permissionId = existing[0]?.id;
      }
      if (!permissionId) {
        continue;
      }

      for (const roleCode of permission.roleCodes) {
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (
         SELECT id FROM permissions
         WHERE permission_code IN ('attendance.manual.create', 'attendance.manual.update', 'attendance.invalidate')
       );`,
    );
    await queryRunner.query(
      `DELETE FROM permissions
       WHERE permission_code IN ('attendance.manual.create', 'attendance.manual.update', 'attendance.invalidate');`,
    );
  }
}
