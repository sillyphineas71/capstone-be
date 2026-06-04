import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationEntity } from './entities/notification.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';

@Module({
  imports: [
    AccountsModule,
    TypeOrmModule.forFeature([NotificationEntity]),
  ],
  exports: [TypeOrmModule],
})
export class NotificationsModule {}
