import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}

/**
 * MailService — Gửi email qua SMTP (Brevo hoặc bất kỳ SMTP nào).
 *
 * - Đọc cấu hình từ env: MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, ...
 * - Nếu MAIL_ENABLED=false: không gửi, log skip message.
 * - Không log MAIL_PASS, MAIL_USER trong bất kỳ tình huống nào.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private readonly mailEnabled: boolean;
  private readonly fromAddress: string;
  private readonly fromName: string;

  constructor(private readonly configService: ConfigService) {
    this.mailEnabled = this.configService.get<boolean>('MAIL_ENABLED', false);
    this.fromAddress = this.configService.get<string>('MAIL_FROM', 'noreply@capstone.local');
    this.fromName = this.configService.get<string>('MAIL_FROM_NAME', 'CAPSTONE System');
  }

  onModuleInit(): void {
    if (!this.mailEnabled) {
      this.logger.warn('MAIL_ENABLED=false — MailService initialized in dry-run mode (no emails will be sent).');
      return;
    }

    const host = this.configService.get<string>('MAIL_HOST', 'localhost');
    const port = this.configService.get<number>('MAIL_PORT', 1025);
    const secure = this.configService.get<boolean>('MAIL_SECURE', false);
    const user = this.configService.get<string>('MAIL_USER', '');
    const pass = this.configService.get<string>('MAIL_PASS', '');
    const timeout = this.configService.get<number>('MAIL_TIMEOUT_MS', 10000);

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
      connectionTimeout: timeout,
      socketTimeout: timeout,
    });

    this.logger.log(`MailService initialized — SMTP: ${host}:${port} (secure=${secure})`);
  }

  /**
   * Kiểm tra kết nối SMTP. Dùng cho health check hoặc startup.
   * Trả về true nếu kết nối thành công, false nếu không.
   */
  async verifyConnection(): Promise<boolean> {
    if (!this.mailEnabled || !this.transporter) {
      return false;
    }
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`SMTP connection verification failed: ${message}`);
      return false;
    }
  }

  /**
   * Gửi email.
   *
   * Nếu MAIL_ENABLED=false: skip và log cảnh báo.
   * Không throw lỗi nếu không gửi được — caller cần xử lý kết quả.
   */
  async sendMail(options: SendMailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.mailEnabled || !this.transporter) {
      this.logger.warn(`[MailService] MAIL_ENABLED=false — skipping email to: ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`);
      return { success: false, error: 'Mail is disabled (MAIL_ENABLED=false)' };
    }

    try {
      const result = await this.transporter.sendMail({
        from: `"${this.fromName}" <${this.fromAddress}>`,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        replyTo: options.replyTo,
      });

      this.logger.log(`[MailService] Email sent — messageId: ${result.messageId}`);
      return { success: true, messageId: result.messageId as string };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // Không log thông tin nhạy cảm — chỉ log message lỗi
      this.logger.error(`[MailService] Failed to send email: ${message}`);
      return { success: false, error: message };
    }
  }
}
