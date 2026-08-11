import { DataSource } from 'typeorm';

/**
 * Fixed UUID cua department "Doi tac" - duoc seed bang migration
 * 20260811000001-SeedPartnerDepartment.ts va duoc bao ve khoi sua/xoa
 * o DepartmentsService.updateDepartment().
 */
export const PARTNER_DEPARTMENT_ID = '7c3e2f1a-4b6a-4f2e-9d8c-1a2b3c4d5e6f';

export function isPartnerAccount(
  departmentId: string | null | undefined,
): boolean {
  return departmentId === PARTNER_DEPARTMENT_ID;
}

export async function isPartnerAccountByUserId(
  userId: string,
  dataSource: DataSource,
): Promise<boolean> {
  if (!userId) {
    return false;
  }
  const rows: Array<{ department_id: string | null }> = await dataSource.query(
    `SELECT department_id FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1;`,
    [userId],
  );
  return isPartnerAccount(rows[0]?.department_id);
}