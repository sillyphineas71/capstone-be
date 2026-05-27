import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

interface AuthzRow {
  role_code: string | null;
  permission_code: string | null;
}

@Injectable()
export class AuthzReadRepository {
  constructor(private readonly dataSource: DataSource) {}

  async getEffectiveRolesAndPermissions(
    userId: string,
  ): Promise<{ roles: string[]; permissions: string[] }> {
    const rows = await this.dataSource.query(
      `
        SELECT DISTINCT r.role_code, p.permission_code
        FROM user_roles ur
        INNER JOIN roles r ON r.id = ur.role_id
        LEFT JOIN role_permissions rp ON rp.role_id = r.id
        LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = $1
          AND ur.is_active = true
          AND (ur.expired_at IS NULL OR ur.expired_at > now())
          AND r.is_active = true
          AND (p.id IS NULL OR p.is_active = true)
      `,
      [userId],
    );

    const roles = Array.from(
      new Set(
        rows
          .map((row) => row.role_code)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const permissions = Array.from(
      new Set(
        rows
          .map((row) => row.permission_code)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    return { roles: roles as string[], permissions: permissions as string[] };
  }
}
