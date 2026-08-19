import { DataSource } from 'typeorm';

export const PARTNER_DEPARTMENT_CODE = 'PARTNER';

/**
 * @deprecated Dùng resolvePartnerDepartmentId() hoặc isPartnerAccountByDepartmentCode() thay thế.
 * Giữ lại để test cũ không bị break ngay — sẽ xóa sau khi test được cập nhật.
 */
export const PARTNER_DEPARTMENT_ID = '7c3e2f1a-4b6a-4f2e-9d8c-1a2b3c4d5e6f';

let cachedPartnerDepartmentId: string | null = null;

export async function resolvePartnerDepartmentId(
  dataSource: DataSource,
): Promise<string> {
  if (cachedPartnerDepartmentId) {
    return cachedPartnerDepartmentId;
  }
  const rows: Array<{ id: string }> = await dataSource.query(
    `SELECT id FROM departments WHERE department_code = $1 AND deleted_at IS NULL LIMIT 1;`,
    [PARTNER_DEPARTMENT_CODE],
  );
  if (!rows.length) {
    throw new Error(
      `Department với department_code='${PARTNER_DEPARTMENT_CODE}' không tồn tại trong DB.`,
    );
  }
  cachedPartnerDepartmentId = rows[0].id;
  return cachedPartnerDepartmentId;
}

export function clearPartnerDepartmentCache(): void {
  cachedPartnerDepartmentId = null;
}

export function isPartnerAccount(
  departmentId: string | null | undefined,
): boolean {
  if (!departmentId) return false;
  return (
    departmentId === cachedPartnerDepartmentId ||
    departmentId === PARTNER_DEPARTMENT_ID
  );
}

export async function isPartnerAccountByDepartmentCode(
  departmentId: string | null | undefined,
  dataSource: DataSource,
): Promise<boolean> {
  if (!departmentId) return false;
  const rows: Array<{ department_code: string }> = await dataSource.query(
    `SELECT department_code FROM departments WHERE id = $1 AND deleted_at IS NULL LIMIT 1;`,
    [departmentId],
  );
  return rows[0]?.department_code === PARTNER_DEPARTMENT_CODE;
}

export async function isPartnerAccountByUserId(
  userId: string,
  dataSource: DataSource,
): Promise<boolean> {
  if (!userId) {
    return false;
  }
  const rows: Array<{ department_code: string | null }> =
    await dataSource.query(
      `SELECT d.department_code FROM users u JOIN departments d ON d.id = u.department_id AND d.deleted_at IS NULL WHERE u.id = $1 AND u.deleted_at IS NULL LIMIT 1;`,
      [userId],
    );
  return rows[0]?.department_code === PARTNER_DEPARTMENT_CODE;
}
