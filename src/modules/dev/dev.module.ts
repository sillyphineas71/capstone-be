import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DevController } from './dev.controller.js';
import { MailModule } from '../mail/mail.module.js';

/**
 * DevModule — Chỉ load khi NODE_ENV=development.
 *
 * Cung cấp các endpoint test utilities:
 * - POST /dev/test-mail — test SMTP connection
 *
 * KHÔNG được load ở production.
 * KHÔNG expose bất kỳ secret/credential nào trong response.
 */
@Module({
  imports: [ConfigModule, MailModule],
  controllers: [DevController],
})
export class DevModule {}
