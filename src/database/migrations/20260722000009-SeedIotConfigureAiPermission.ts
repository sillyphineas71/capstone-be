import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `iot.device.configure_ai` (IAC-001 / UC-96 — Cau hinh chuc nang AI cua camera).
 *
 * Cong route PATCH /api/v1/iot-devices/:id/ai-config (bat/tat nhan dien mat/bien so/dem nguoi).
 *
 * ⚠ ROLES: DUNG 1 role — `SYSTEM_ADMIN`. Nhat quan voi `iot_devices:configure_rtsp` /
 * `configure_face_server` (cung ban chat: cau hinh tham so ky thuat cua thiet bi, chi SYSTEM_ADMIN).
 * **KHAC CA BA tien le gan day**: `zones.zone.read` 4 role, `zones.gate_log.read` 3 role,
 * `anpr.vehicle.admin_read` / thao tac ghi zone 2 role. UC-96 chi 1 role — copy nham mang 2/3/4
 * phan tu deu sai. KHONG seed ADMIN/INTERNAL_USER (ma loi thoi, WHERE role_code khong khop ->
 * im lang khong insert).
 *
 * ⚠ QUY UOC: dung DAU CHAM 3 tang `iot.device.configure_ai` (`module_code='iot'`,
 * `action_code='configure_ai'`) — lech voi `iot_devices:configure_rtsp` (dau hai cham, di san)
 * la CHU DICH: 9 UC gan day dung dau cham, khong noi dai di san.
 *
 * Idempotent hoan toan. Mirror 20260722000007-SeedGateLogReadPermission.ts.
 * DATA: CHI ghi `permissions` + `role_permissions` — KHONG dung schema.
 */
export class SeedIotConfigureAiPermission20260722000009 implements MigrationInterface {
  name = 'SeedIotConfigureAiPermission20260722000009';

  private readonly permission = {
    code: 'iot.device.configure_ai',
    name: 'Cau hinh chuc nang AI cua camera',
    module: 'iot',
    action: 'configure_ai',
    description:
      'Cho phep bat/tat chuc nang AI cua camera (nhan dien mat/bien so/dem nguoi) - chi ghi cau hinh',
  };

  // 1 ROLE — co y khac 2/3/4 role cua cac tien le zones/anpr (xem JSDoc tren).
  private readonly roles = ['SYSTEM_ADMIN'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const p = this.permission;
    const inserted = (await queryRunner.query(
      'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
      [p.code, p.name, p.module, p.action, p.description],
    )) as Array<{ id: string }>;
    let permissionId = inserted[0]?.id;
    if (!permissionId) {
      const existing = (await queryRunner.query(
        'SELECT id FROM permissions WHERE permission_code = $1',
        [p.code],
      )) as Array<{ id: string }>;
      permissionId = existing[0]?.id;
    }
    if (!permissionId) return;

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
