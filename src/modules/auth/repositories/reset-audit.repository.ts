import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class ResetAuditRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Logs a password reset OTP request event.
   * Absolutely NO plain OTP or sensitive tokens should be saved here.
   */
  async logOtpRequest(params: {
    userId: string;
    email: string;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
  }): Promise<void> {
    await this.dataSource.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, ip_address, user_agent, request_id, severity, metadata_json)
        VALUES ($1, 'password_reset_request', 'users', $2, $3, $4, $5, 'info', $6::jsonb)
      `,
      [
        params.userId,
        params.userId, // Entity ID is the user
        params.ipAddress ?? null,
        params.userAgent ?? null,
        params.requestId ?? null,
        JSON.stringify({ email: params.email, action: 'request_otp' }),
      ],
    );
  }

  /**
   * Logs a password reset confirmation/success event.
   * Absolutely NO plain passwords or OTPs should be saved here.
   */
  async logResetSuccess(params: {
    userId: string;
    email: string;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
  }): Promise<void> {
    await this.dataSource.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, ip_address, user_agent, request_id, severity, metadata_json)
        VALUES ($1, 'password_reset_success', 'users', $2, $3, $4, $5, 'info', $6::jsonb)
      `,
      [
        params.userId,
        params.userId,
        params.ipAddress ?? null,
        params.userAgent ?? null,
        params.requestId ?? null,
        JSON.stringify({ email: params.email, action: 'confirm_reset' }),
      ],
    );
  }
}
