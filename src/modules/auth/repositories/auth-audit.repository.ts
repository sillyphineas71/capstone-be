import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class AuthAuditRepository {
  constructor(private readonly dataSource: DataSource) {}

  async logLoginSuccess(params: {
    userId: string;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
    sessionId: string;
  }): Promise<void> {
    await this.dataSource.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, ip_address, user_agent, request_id, severity, metadata_json)
        VALUES ($1, 'login', 'user_sessions', $2, $3, $4, $5, 'info', $6::jsonb)
      `,
      [
        params.userId,
        params.sessionId,
        params.ipAddress ?? null,
        params.userAgent ?? null,
        params.requestId ?? null,
        JSON.stringify({ sessionId: params.sessionId }),
      ],
    );
  }
}
