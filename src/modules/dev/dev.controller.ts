import { Body, Controller, Post } from '@nestjs/common';
import { MailService } from '../mail/mail.service.js';

interface TestMailBody {
  to?: string;
  subject?: string;
}

/**
 * DevController — Test utilities, chỉ expose khi NODE_ENV=development.
 *
 * Được load bởi DevModule, module này chỉ được import vào AppModule
 * khi NODE_ENV=development.
 *
 * TUYỆT ĐỐI không expose ở production.
 * KHÔNG log bất kỳ secret, credential, password nào.
 */
@Controller('dev')
export class DevController {
  constructor(private readonly mailService: MailService) {}

  /**
   * Test SMTP connection và gửi email thử.
   *
   * POST /api/v1/dev/test-mail
   * Body: { to?: string, subject?: string }
   *
   * Response: { success, messageId?, error? }
   */
  @Post('test-mail')
  async testMail(
    @Body() body: TestMailBody,
  ): Promise<{ success: boolean; messageId?: string; error?: string; message: string }> {
    const to = body.to ?? 'dev-test@capstone.local';
    const subject = body.subject ?? '[DEV] CAPSTONE Mail Test';

    const result = await this.mailService.sendMail({
      to,
      subject,
      text: 'This is a test email sent from CAPSTONE backend dev utilities.',
      html: '<p>This is a <strong>test email</strong> sent from CAPSTONE backend dev utilities.</p>',
    });

    return {
      ...result,
      message: result.success
        ? `Test email sent successfully to: ${to}`
        : `Test email failed: ${result.error}`,
    };
  }

  /**
   * Kiểm tra SMTP connection (không gửi email).
   *
   * POST /api/v1/dev/test-mail-verify
   */
  @Post('test-mail-verify')
  async testMailVerify(): Promise<{ connected: boolean; message: string }> {
    const connected = await this.mailService.verifyConnection();
    return {
      connected,
      message: connected
        ? 'SMTP connection verified successfully.'
        : 'SMTP connection failed — check MAIL_* env variables.',
    };
  }
}
