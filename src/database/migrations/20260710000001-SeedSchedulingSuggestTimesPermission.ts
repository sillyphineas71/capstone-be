import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission scheduling.suggest.times (UC-SM-02).
 * Gán cho toàn bộ role nội bộ có thể tạo cuộc họp: INTERNAL_USER, MANAGER,
 * BUSINESS_ADMIN, SYSTEM_ADMIN (nhất quán với scheduling.suggest.rooms).
 */
export class SeedSchedulingSuggestTimesPermission20260710000001 implements MigrationInterface {
  name = 'SeedSchedulingSuggestTimesPermission20260710000001';

  private readonly permission = {
    code: 'scheduling.suggest.times',
    name: 'Goi y khung gio hop toi uu',
    action: 'suggest.times',
    description:
      'Cho phep goi y cac khung gio hop toi uu dua tren lich ranh/ban cua khach moi',
  };

  // NOTE: role_code naming đã bị dùng không nhất quán giữa các migration cũ
  // trong repo này (thấy cả 'ADMIN', 'EMPLOYEE', 'INTERNAL_USER' cho cùng ý
  // nghĩa "nhân viên nội bộ"). Liệt kê toàn bộ biến thể đã thấy — role_code
  // không tồn tại sẽ tự động bị bỏ qua an toàn (xem vòng lặp `up()` dưới,
  // chỉ insert khi `SELECT id FROM roles WHERE role_code = ...` có kết quả).
  private readonly roles = [
    'ADMIN',
    'EMPLOYEE',
    'INTERNAL_USER',
    'MANAGER',
    'BUSINESS_ADMIN',
    'SYSTEM_ADMIN',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const p = this.permission;
    const inserted: Array<{ id: string }> = await queryRunner.query(
      'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
      [p.code, p.name, 'scheduling', p.action, p.description],
    );
    let permissionId = inserted[0]?.id;
    if (!permissionId) {
      const existing: Array<{ id: string }> = await queryRunner.query(
        'SELECT id FROM permissions WHERE permission_code = $1',
        [p.code],
      );
      permissionId = existing[0]?.id;
    }

    if (!permissionId) {
      return;
    }

    for (const roleCode of this.roles) {
      await queryRunner.query(
        'INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, $2, NOW() FROM roles r WHERE r.role_code = $1 AND r.is_active = true ON CONFLICT (role_id, permission_id) DO NOTHING;',
        [roleCode, permissionId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const code = this.permission.code;
    await queryRunner.query(
      'DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = $1);',
      [code],
    );
    await queryRunner.query(
      'DELETE FROM permissions WHERE permission_code = $1;',
      [code],
    );
  }
}
