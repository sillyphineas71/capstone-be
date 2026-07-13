import { DataSource } from 'typeorm';

/**
 * Seed permission cho AI Meeting Minutes Draft (MKM-AI-01):
 * - meeting.minutes.ai_draft.create
 *
 * Pattern: 20260702000001-SeedMeetingMinutesCreatePermission.ts
 * Role codes da xac minh khop bang roles (spec 2.2, 2026-07-07).
 */
export async function seedMeetingMinutesAiDraftPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const createCode = 'meeting.minutes.ai_draft.create';
    const createName = 'Tao bien ban hop nhap bang AI';
    const moduleCode = 'minutes';
    const actionCode = 'minutes.ai_draft.create';
    const createDesc =
      'Cho phep Host cua cuoc hop (hoac System Admin) tao background job sinh ban nhap bien ban hop bang AI tu transcript';

    const createResult = (await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [createCode, createName, moduleCode, actionCode, createDesc],
    )) as Array<{ id: string }>;

    let createPermId: string | undefined = createResult[0]?.id;
    if (!createPermId) {
      // Seed chay lai (idempotent): permission da ton tai, lay id de dam bao
      // role_permissions van duoc gan du neu lan truoc bi thieu.
      const existing = (await queryRunner.query(
        `SELECT id FROM permissions WHERE permission_code = $1;`,
        [createCode],
      )) as Array<{ id: string }>;
      createPermId = existing[0]?.id;
    }

    if (createPermId) {
      // INTERNAL_USER va EMPLOYEE la 2 alias cho cung vai tro nhan vien thuong
      // tuy moi truong DB (DB local hien seed EMPLOYEE, khong co INTERNAL_USER).
      // Liet ke ca 2 — role nao ton tai thi duoc gan, role khong ton tai bi bo
      // qua an toan (SELECT khong ra row).
      const roleCodes = [
        'INTERNAL_USER',
        'EMPLOYEE',
        'MANAGER',
        'BUSINESS_ADMIN',
        'SYSTEM_ADMIN',
      ];
      for (const roleCode of roleCodes) {
        const roleResult = (await queryRunner.query(
          `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
          [roleCode],
        )) as Array<{ id: string }>;
        if (roleResult[0]?.id) {
          await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id, granted_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (role_id, permission_id) DO NOTHING;`,
            [roleResult[0].id, createPermId],
          );
        }
      }
    }

    await queryRunner.commitTransaction();
    console.log('[Seed] Meeting minutes AI draft permission seeded');
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
