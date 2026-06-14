import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailService } from './mail.service.js';

/**
 * MailModule — Global module cung cấp MailService dùng chung.
 *
 * Cấu hình SMTP lấy từ env (không hard-code).
 * Nếu MAIL_ENABLED=false, MailService.sendMail() sẽ skip và log cảnh báo.
 *
 * Sử dụng Brevo SMTP cho production, hoặc bất kỳ SMTP nào tương thích.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
