import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { MailService } from '../../mail/mail.service';
import { buildOtpEmail } from '../../mail/templates/builders';

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);

  constructor(private readonly mailService: MailService) {}

  async sendOtp(email: string, otp: string): Promise<void> {
    // Test hook: simulate SMTP failure for error handling verification
    if (email.endsWith('@error.com')) {
      throw new InternalServerErrorException('AUTH_EMAIL_DISPATCH_FAILED');
    }

    const subject = 'Khoi phuc mat khau - Smart Meeting Management';
    const text = [
      'Kinh gui nguoi dung,',
      '',
      'Ban da gui yeu cau dat lai mat khau tren he thong Smart Meeting Management.',
      `Ma OTP xac thuc cua ban la: ${otp}`,
      '',
      'Ma OTP nay co hieu luc trong vong 10 phut. De bao mat, vui long khong chia se ma nay cho bat ky ai.',
      'Neu ban khong gui yeu cau nay, vui long bo qua email nay va bao mat tai khoan.',
      '',
      'Tran trong,',
      'He thong Smart Meeting Management',
    ].join('\n');

    const html = buildOtpEmail({ otp, expiresMinutes: 10 });
    const result = await this.mailService.sendMail({
      to: email,
      subject,
      text,
      html,
    });

    if (!result.success) {
      this.logger.error(
        `Failed to send OTP email to ${email}: ${result.error}`,
      );
      throw new InternalServerErrorException('AUTH_EMAIL_DISPATCH_FAILED');
    }

    this.logger.log(`OTP email sent to ${email}`);
  }
}
