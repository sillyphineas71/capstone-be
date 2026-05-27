import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface UserResetRecord {
  id: string;
  email: string;
  passwordHash: string;
  accountStatus: string;
  employmentStatus: string;
  deletedAt: Date | null;
}

@Injectable()
export class UsersResetRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Finds a user by email, returning core fields needed for status and existence checking.
   * Note: This returns the user even if they are inactive, locked, resigned, or soft-deleted,
   * so that the service layer can perform the proper unified E1 restriction check.
   */
  async findByEmailForReset(email: string): Promise<UserResetRecord | null> {
    const rows = await this.dataSource.query(
      `
        SELECT id, email, password_hash, account_status, employment_status, deleted_at
        FROM users
        WHERE email = $1
        LIMIT 1
      `,
      [email],
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      accountStatus: row.account_status,
      employmentStatus: row.employment_status,
      deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    };
  }

  /**
   * Updates user's password, resets must_change_password flag, and marks password_updated_at in a transaction.
   */
  async updatePasswordInTransaction(userId: string, newPasswordHash: string): Promise<void> {
    await this.dataSource.transaction(async (transactionalEntityManager) => {
      await transactionalEntityManager.query(
        `
          UPDATE users
          SET password_hash = $2,
              password_updated_at = now(),
              must_change_password = false,
              updated_at = now()
          WHERE id = $1
        `,
        [userId, newPasswordHash],
      );
    });
  }
}
