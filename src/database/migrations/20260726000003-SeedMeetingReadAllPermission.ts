import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission meeting.read.all cho BE-02 (GET /api/v1/meetings, list admin).
 * Role mapping: meeting.read.all -> BUSINESS_ADMIN, SYSTEM_ADMIN (theo
 * PLAN_THUC_THI_P0_CODE_VA_SPEC_2026-07-26.md, T-4.8). Khac voi
 * schedule.read.self (meetings.controller.ts) - quyen do chi xem lich cua chinh minh.
 * Khuon: 20260726000001-SeedVehicleAlertReadPermission.ts (idempotent WHERE NOT EXISTS).
 */
export class SeedMeetingReadAllPermission20260726000003 implements MigrationInterface {
  name = 'SeedMeetingReadAllPermission20260726000003';

  private readonly entries: Array<{
    code: string;
    name: string;
    action: string;
    roles: string[];
  }> = [
    {
      code: 'meeting.read.all',
      name: 'Xem danh sach tat ca cuoc hop (admin)',
      action: 'read',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const e of this.entries) {
      await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         SELECT $1::varchar, $2::varchar, 'meetings', $3::varchar, $2::text, true
         WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = $1);`,
        [e.code, e.name, e.action],
      );

      const rows = (await queryRunner.query(
        `SELECT id FROM permissions WHERE permission_code = $1;`,
        [e.code],
      )) as Array<{ id: string }>;
      const permissionId = rows[0]?.id;
      if (!permissionId) continue;

      for (const roleCode of e.roles) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted_at)
           SELECT r.id, $2::uuid, NOW()
           FROM roles r
           WHERE r.role_code = $1 AND r.is_active = true
             AND NOT EXISTS (
               SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = $2::uuid
             );`,
          [roleCode, permissionId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const codes = this.entries.map((e) => e.code);
    await queryRunner.query(
      `DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1));`,
      [codes],
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code = ANY($1);`,
      [codes],
    );
  }
}
