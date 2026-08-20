import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { MailService } from '../../mail/mail.service.js';
import {
  buildGuestInviteEmail,
  buildGuestOtpEmail,
} from '../../mail/templates/builders.js';
import { GuestAccessConfigService } from '../config/guest-access-config.service.js';

/**
 * GuestEmailService — gửi mail chứa link mời / mã OTP của khách.
 *
 * Mirror `AuthEmailService.sendOtp()` (luồng đặt lại mật khẩu): gọi
 * `MailService.sendMail()` TRỰC TIẾP, KHÔNG qua `NotificationsService` —
 * hàng đó persist `content`/`emailHtml` VĨNH VIỄN vào bảng `notifications`,
 * không được dùng cho mail chứa bí mật (plan.md mục 2.2/7.1/7.3).
 */
@Injectable()
export class GuestEmailService {
  private readonly logger = new Logger(GuestEmailService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly config: GuestAccessConfigService,
  ) {}

  async sendInviteLink(params: {
    to: string;
    meetingTitle: string;
    startTime: Date;
    endTime: Date;
    hostName: string;
    link: string;
  }): Promise<void> {
    const html = buildGuestInviteEmail(params);
    const result = await this.mailService.sendMail({
      to: params.to,
      subject: `Thư mời tham dự: ${params.meetingTitle}`,
      text: `Bạn được mời tham dự cuộc họp "${params.meetingTitle}". Truy cập: ${params.link}`,
      html,
    });

    if (!result.success) {
      this.logger.error(
        `Failed to send guest invite email to ${params.to}: ${result.error}`,
      );
      throw new InternalServerErrorException(
        'GUEST_INVITE_EMAIL_DISPATCH_FAILED',
      );
    }

    this.logger.log(`Guest invite email sent to ${params.to}`);
  }

  async sendOtp(params: {
    to: string;
    otp: string;
    meetingTitle: string;
  }): Promise<void> {
    const expiresMinutes = Math.round(this.config.getOtpTtlSeconds() / 60);
    const html = buildGuestOtpEmail({
      otp: params.otp,
      meetingTitle: params.meetingTitle,
      expiresMinutes,
    });
    const result = await this.mailService.sendMail({
      to: params.to,
      subject: 'Mã xác nhận tham dự cuộc họp',
      text: `Mã OTP của bạn là: ${params.otp}. Mã có hiệu lực trong ${expiresMinutes} phút.`,
      html,
    });

    if (!result.success) {
      this.logger.error(
        `Failed to send guest OTP email to ${params.to}: ${result.error}`,
      );
      throw new InternalServerErrorException('GUEST_OTP_EMAIL_DISPATCH_FAILED');
    }

    this.logger.log(`Guest OTP email sent to ${params.to}`);
  }
}
