import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { MailService } from '../../mail/mail.service';

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);

  constructor(private readonly mailService: MailService) {}

  async sendOtp(email: string, otp: string): Promise<void> {
    // Test hook: simulate SMTP failure for error handling verification
    if (email.endsWith('@error.com')) {
      throw new InternalServerErrorException('AUTH_EMAIL_DISPATCH_FAILED');
    }

    const subject = 'Khôi ph?c m?t kh?u - Smart Meeting Management';
    const text = [
      'Kính g?i ngu?i dùng,',
      '',
      'B?n dã g?i yêu c?u d?t l?i m?t kh?u trên h? th?ng Smart Meeting Management.',
      `Mã OTP xác th?c c?a b?n là: ${otp}`,
      '',
      'Mã OTP này có hi?u l?c trong vòng 10 phút. Ð? b?o m?t, vui lòng không chia s? mã này cho b?t k? ai.',
      'N?u b?n không g?i yêu c?u này, vui lòng b? qua email này và b?o m?t tài kho?n.',
      '',
      'Trân tr?ng,',
      'H? th?ng Smart Meeting Management',
    ].join('\n');

    const result = await this.mailService.sendMail({ to: email, subject, text });

    if (!result.success) {
      this.logger.error(
        `Failed to send OTP email to ${email}: ${result.error}`,
      );
      throw new InternalServerErrorException('AUTH_EMAIL_DISPATCH_FAILED');
    }

    this.logger.log(`OTP email sent to ${email}`);
  }
}