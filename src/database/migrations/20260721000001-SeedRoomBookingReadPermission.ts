import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission room.booking.read cho feature feat-list-room-bookings.
 * Idempotent: dung WHERE NOT EXISTS de tranh trung lap khi chay lai.
 */
export class SeedRoomBookingReadPermission20260721000001 implements MigrationInterface {
  name = 'SeedRoomBookingReadPermission20260721000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       SELECT 'room.booking.read', 'Xem danh sach dat phong', 'rooms', 'read', 'Xem danh sach toan bo booking phong', true
       WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = 'room.booking.read');`,
    );

    const rows = (await queryRunner.query(
      `SELECT id FROM permissions WHERE permission_code = 'room.booking.read';`,
    )) as Array<{ id: string }>;

    const permissionId = rows[0]?.id;
    if (!permissionId) return;

    const roleCodes = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN', 'MANAGER'];
    for (const roleCode of roleCodes) {
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = 'room.booking.read');`,
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code = 'room.booking.read';`,
    );
  }
}
