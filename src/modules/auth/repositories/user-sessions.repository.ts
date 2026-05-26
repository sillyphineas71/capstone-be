import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthSessionRecord } from '../types/login.types';

@Injectable()
export class UserSessionsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async createSession(params: {
    userId: string;
    refreshTokenHash: string;
    ipAddress?: string;
    userAgent?: string;
    expiresAt: Date;
  }): Promise<AuthSessionRecord> {
    const rows = await this.dataSource.query(
      `
        INSERT INTO user_sessions (user_id, refresh_token_hash, ip_address, user_agent, expires_at, is_active)
        VALUES ($1, $2, $3, $4, $5, true)
        RETURNING id, user_id, expires_at
      `,
      [
        params.userId,
        params.refreshTokenHash,
        params.ipAddress ?? null,
        params.userAgent ?? null,
        params.expiresAt.toISOString(),
      ],
    );

    return {
      id: rows[0].id,
      userId: rows[0].user_id,
      expiresAt: new Date(rows[0].expires_at),
    };
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.dataSource.query(
      `
        UPDATE user_sessions
        SET is_active = false, revoked_at = now(), revoke_reason = $2
        WHERE id = $1
      `,
      [sessionId, reason],
    );
  }
}
