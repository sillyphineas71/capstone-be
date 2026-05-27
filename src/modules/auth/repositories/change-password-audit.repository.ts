import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface ChangePasswordAuditParams {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

@Injectable()
export class ChangePasswordAuditRepository {
  private readonly logger = new Logger(ChangePasswordAuditRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Writes a PASSWORD_CHANGE_SUCCESS audit record.
   * Called fire-and-forget — caller should .catch(() => {}) to avoid blocking.
   * NEVER logs plain password or hash.
   */
  async logSuccess(params: ChangePasswordAuditParams): Promise<void> {
    await this.dataSource.query(
      `
        INSERT INTO audit_logs
          (user_id, action_type, entity_type, entity_id,
           ip_address, user_agent, request_id, severity, metadata_json)
        VALUES ($1, 'password_change_success', 'users', $2, $3, $4, $5, 'info', $6::jsonb)
      `,
      [
        params.userId,
        params.userId,
        params.ipAddress ?? null,
        params.userAgent ?? null,
        params.requestId ?? null,
        JSON.stringify({}),
      ],
    );
  }

  /**
   * Writes a PASSWORD_CHANGE_RATE_LIMITED audit record.
   * Called fire-and-forget after the 5th consecutive wrong-password attempt.
   * severity = 'warn' to flag potential brute-force.
   */
  async logRateLimited(params: ChangePasswordAuditParams): Promise<void> {
    await this.dataSource.query(
      `
        INSERT INTO audit_logs
          (user_id, action_type, entity_type, entity_id,
           ip_address, user_agent, request_id, severity, metadata_json)
        VALUES ($1, 'password_change_rate_limited', 'users', $2, $3, $4, $5, 'warn', $6::jsonb)
      `,
      [
        params.userId,
        params.userId,
        params.ipAddress ?? null,
        params.userAgent ?? null,
        params.requestId ?? null,
        JSON.stringify({ failedAttempts: 5 }),
      ],
    );
  }
}
