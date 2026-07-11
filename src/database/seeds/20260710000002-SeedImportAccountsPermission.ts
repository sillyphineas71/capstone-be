import { DataSource } from 'typeorm';

/**
 * Seed permission `accounts.user.import` cho tính năng tạo tài khoản nhân viên
 * bằng import Excel (ACCT-IMPORT-ACCOUNT-001 / UC-AM-02).
 * Gán cho các role quản lý tài khoản: BUSINESS_ADMIN, SYSTEM_ADMIN.
 */
export async function seedImportAccountsPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permissionResult = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [
        'accounts.user.import',
        'Import tài khoản nhân viên bằng Excel',
        'accounts',
        'user_import',
        'Cho phép tạo hàng loạt tài khoản nhân viên từ tệp Excel (preview + commit)',
      ],
    );

    let permissionId = permissionResult[0]?.id as string | undefined;

    if (!permissionId) {
      const existing = await queryRunner.query(
        `SELECT id FROM permissions WHERE permission_code = $1;`,
        ['accounts.user.import'],
      );
      permissionId = existing[0]?.id as string | undefined;
    }

    if (permissionId) {
      const roleCodes = ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'];
      for (const roleCode of roleCodes) {
        const roleResult = await queryRunner.query(
          `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
          [roleCode],
        );
        if (roleResult[0]?.id) {
          await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id, granted_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (role_id, permission_id) DO NOTHING;`,
            [roleResult[0].id, permissionId],
          );
        }
      }
    }

    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
