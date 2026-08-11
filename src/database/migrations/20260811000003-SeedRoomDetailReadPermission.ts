import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission room.detail.read cho feature ROOM-VIEW-DETAIL-001.
 * Idempotent: dung WHERE NOT EXISTS de tranh trung lap khi chay lai.
 * Mirror pattern: 20260721000001-SeedRoomBookingReadPermission.ts
 * role_codes: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'] — KHONG MANAGER (khac room.booking.read, xem D-3).
 * KHONG dat trong src/database/seeds/ — migrations/ co runner chinh thuc.
 */
export class SeedRoomDetailReadPermission20260811000003 implements MigrationInterface {
  name = 'SeedRoomDetailReadPermission20260811000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       SELECT 'room.detail.read',
              'Xem chi tiet phong hop (day du)',
              'rooms',
              'read',
              'Xem thong tin chi tiet 1 phong hop (info tinh + realtime + no-show status), chi danh cho vai tro quan tri',
              true
       WHERE NOT EXISTS (
         SELECT 1 FROM permissions WHERE permission_code = 'room.detail.read'
       );`,
    );

    const rows = (await queryRunner.query(
      `SELECT id FROM permissions WHERE permission_code = 'room.detail.read';`,
    )) as Array<{ id: string }>;

    const permissionId = rows[0]?.id;
    if (!permissionId) return;

    // D-3: CHI seed cho SYSTEM_ADMIN + BUSINESS_ADMIN, KHONG MANAGER/EMPLOYEE
    const roleCodes = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'];
    for (const roleCode of roleCodes) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, $2::uuid, NOW()
         FROM roles r
         WHERE r.role_code = $1 AND r.is_active = true
           AND NOT EXISTS (
             SELECT 1 FROM role_permissions rp2
             WHERE rp2.role_id = r.id AND rp2.permission_id = $2::uuid
           );`,
        [roleCode, permissionId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (
         SELECT id FROM permissions WHERE permission_code = 'room.detail.read'
       );`,
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code = 'room.detail.read';`,
    );
  }
}
