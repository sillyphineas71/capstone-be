import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Sends a Vietnamese password reset OTP email to the user.
   * If the email ends with '@error.com', it simulates an SMTP dispatch failure.
   */
  async sendOtp(email: string, otp: string): Promise<void> {
    try {
      this.logger.log(
        `[Email Service] Gửi mã OTP khôi phục mật khẩu đến: ${email}`,
      );

      const mailContent = `
========================================================================
Kính gửi người dùng,

Bạn đã gửi yêu cầu đặt lại mật khẩu trên hệ thống Smart Meeting Management.
Mã OTP xác thực của bạn là: ${otp}

Mã OTP này có hiệu lực trong vòng 10 phút. Để bảo mật, vui lòng không chia sẻ mã này cho bất kỳ ai.
Nếu bạn không gửi yêu cầu này, vui lòng bỏ qua email này và bảo mật tài khoản.

Trân trọng,
Hệ thống Smart Meeting Management
========================================================================
      `;

      this.logger.log(mailContent);

      // Simulating external SMTP failure for error handling verification
      if (email.endsWith('@error.com')) {
        throw new Error('Simulated SMTP connection failed');
      }
    } catch (error) {
      this.logger.error(
        `Lỗi khi gửi email đến ${email}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('AUTH_EMAIL_DISPATCH_FAILED');
    }
  }
}
