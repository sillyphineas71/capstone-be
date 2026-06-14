import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { NotificationEntity } from './entities/notification.entity.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationWorkerService } from './notification-worker.service.js';
import { BackgroundJobEntity } from '../administration/entities/background-job.entity.js';

@Module({
    imports: [
        ConfigModule,
        TypeOrmModule.forFeature([
            NotificationEntity,
            BackgroundJobEntity,
        ]),
        BullModule.registerQueueAsync({
            name: 'QUEUE_NOTIFICATION_NAME',
            inject: [ConfigService],
            useFactory: (cs: ConfigService) => ({
                name: cs.get<string>('QUEUE_NOTIFICATION', 'notification'),
            }),
        }),
    ],
    providers: [
        NotificationsService,
        NotificationWorkerService,
    ],
    exports: [TypeOrmModule, NotificationsService],
})
export class NotificationsModule {}
