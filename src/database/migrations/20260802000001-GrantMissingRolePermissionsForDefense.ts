import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DEFENSE-GAP-01 — gan cac cap (role, permission) con thieu de mo UC-11, 12, 18, 22
 * va vai gap nho khac phat hien khi doi chieu voi dump RDS production ngay 02/08.
 *
 * Tat ca 13 permission_code duoi day DA TON TAI trong bang `permissions` (tao boi cac
 * migration seed truoc: 20260720000005-BackfillRolePermissions,
 * 20260727000001-SeedDepartmentUpdatePermission, 20260726000004-SeedMeetingUpdateOwnPermission,
 * 20260718000008-SeedRoleReadPermission, 20260729000003-SeedCampusDashboardManagerSummaryPermission).
 * Migration nay CHI them dong role_permissions con thieu, KHONG tao permission moi.
 *
 * Mirror 20260731000001-GrantManagerMeetingRequestApproveReject.ts — dung
 * WHERE NOT EXISTS de idempotent, khong phu thuoc unique constraint.
 *
 * Danh sach cap (role, permission) — ly do:
 *  - BUSINESS_ADMIN + department.create        man DepartmentManagement thuoc BA — UC-11
 *  - BUSINESS_ADMIN + department.update        UC-12
 *  - MANAGER        + meeting.room.update      UC-18. CHI Manager — KHONG cap EMPLOYEE
 *                                               (Employee tu doi phong se bypass luong
 *                                               duyet dat phong UC-88)
 *  - EMPLOYEE       + meeting.participant.remove  Host xoa thanh vien hop cua chinh minh — UC-22
 *  - BUSINESS_ADMIN + meeting.cancel.own       BA co meeting.create -> phai huy duoc hop minh tao
 *  - BUSINESS_ADMIN + meeting.cancel.any       BA co meeting.read.all (thay moi hop) ->
 *                                               quan tri huy duoc moi hop cho nhat quan
 *  - BUSINESS_ADMIN + meeting.update.own       BA sua hop minh tao
 *  - BUSINESS_ADMIN + meeting.time.update      BA doi gio hop
 *  - BUSINESS_ADMIN + schedule.read.self       Lich ca nhan cua chinh minh — moi role nen co
 *  - BUSINESS_ADMIN + account.role.read        BA quan user (da co accounts.user.manage) can
 *                                               doc danh sach role cho dropdown. CHI DOC
 *  - BUSINESS_ADMIN + recording.files.play     BA da co recording.files.manage + read ma
 *                                               khong phat lai duoc -> thieu nhat quan
 *  - EMPLOYEE       + iot.device.read          Employee trong phong hop can xem thiet bi;
 *                                               nhat quan voi equipment.read da co EMPLOYEE
 *  - SYSTEM_ADMIN   + campus_dashboard.manager_summary.read  Hien CHI MANAGER -> SA mo
 *                                               dashboard bi 403, bat thuong
 *
 * TUYET DOI KHONG CAP (quyet dinh co chu dich — dung sua nham):
 *  - accounts.user.update_roles cho BUSINESS_ADMIN — gan role = leo thang dac quyen,
 *    BA co the tu nang thanh SYSTEM_ADMIN. Giu SA only.
 *  - security_alert.read cho EMPLOYEE — canh bao an ninh thuoc van hanh an ninh,
 *    khong phai viec nhan vien thuong.
 *  - meeting.participant.add.external cho EMPLOYEE — moi khach ngoai cong ty = nguoi la
 *    vao khuon vien, phai qua Manager.
 *  - meeting.room.update cho EMPLOYEE — bypass luong duyet dat phong.
 */
export class GrantMissingRolePermissionsForDefense20260802000001 implements MigrationInterface {
  name = 'GrantMissingRolePermissionsForDefense20260802000001';

  private readonly grants: Array<[role: string, permission: string]> = [
    ['BUSINESS_ADMIN', 'department.create'],
    ['BUSINESS_ADMIN', 'department.update'],
    ['MANAGER', 'meeting.room.update'],
    ['EMPLOYEE', 'meeting.participant.remove'],
    ['BUSINESS_ADMIN', 'meeting.cancel.own'],
    ['BUSINESS_ADMIN', 'meeting.cancel.any'],
    ['BUSINESS_ADMIN', 'meeting.update.own'],
    ['BUSINESS_ADMIN', 'meeting.time.update'],
    ['BUSINESS_ADMIN', 'schedule.read.self'],
    ['BUSINESS_ADMIN', 'account.role.read'],
    ['BUSINESS_ADMIN', 'recording.files.play'],
    ['EMPLOYEE', 'iot.device.read'],
    ['SYSTEM_ADMIN', 'campus_dashboard.manager_summary.read'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [role, permission] of this.grants) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, p.id, NOW()
         FROM roles r, permissions p
         WHERE r.role_code = $1 AND r.is_active = true
           AND p.permission_code = $2
           AND NOT EXISTS (
             SELECT 1 FROM role_permissions rp
             WHERE rp.role_id = r.id AND rp.permission_id = p.id
           );`,
        [role, permission],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [role, permission] of this.grants) {
      await queryRunner.query(
        `DELETE FROM role_permissions
         WHERE role_id IN (SELECT id FROM roles WHERE role_code = $1)
           AND permission_id IN (SELECT id FROM permissions WHERE permission_code = $2);`,
        [role, permission],
      );
    }
  }
}
