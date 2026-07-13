import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service.js';

/**
 * QueueModule — Global module đăng ký BullMQ queues.
 *
 * Đăng ký 9 queues lấy name từ env:
 * QUEUE_AUTH, QUEUE_NOTIFICATION, QUEUE_ACCOUNT_IMPORT, QUEUE_MEDIA_PROCESSING,
 * QUEUE_TRANSCRIPTION, QUEUE_REPORT_EXPORT, QUEUE_MINUTES_EXPORT, QUEUE_SCHEDULER,
 * QUEUE_MINUTES_AI_DRAFT
 *
 * QueueService cung cấp helper addJob() dùng chung.
 * Không implement worker business logic ở đây.
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('BULL_REDIS_HOST', 'localhost'),
          port: configService.get<number>('BULL_REDIS_PORT', 6379),
          password:
            configService.get<string>('BULL_REDIS_PASSWORD', '') || undefined,
          db: configService.get<number>('BULL_REDIS_DB', 1),
        },
        prefix: configService.get<string>('BULL_QUEUE_PREFIX', 'capstone'),
        defaultJobOptions: {
          attempts: configService.get<number>('BULL_DEFAULT_ATTEMPTS', 3),
          backoff: {
            type: 'exponential',
            delay: configService.get<number>(
              'BULL_DEFAULT_BACKOFF_DELAY_MS',
              5000,
            ),
          },
          removeOnComplete: configService.get<boolean>(
            'BULL_REMOVE_ON_COMPLETE',
            true,
          ),
          removeOnFail: configService.get<boolean>(
            'BULL_REMOVE_ON_FAIL',
            false,
          ),
        },
      }),
    }),
    // Đăng ký tất cả queues — tên lấy từ env lúc runtime qua QueueService
    // BullModule.registerQueue() yêu cầu tên tĩnh, nên ta dùng forFeature động
    BullModule.registerQueueAsync(
      {
        name: 'QUEUE_AUTH_NAME',
        inject: [ConfigService],
        useFactory: (cs: ConfigService) => ({
          name: cs.get<string>('QUEUE_AUTH', 'auth'),
        }),
      },
      {
        name: 'QUEUE_NOTIFICATION_NAME',
        inject: [ConfigService],
        useFactory: (cs: ConfigService) => ({
          name: cs.get<string>('QUEUE_NOTIFICATION', 'notification'),
        }),
      },
      {
        name: 'QUEUE_ACCOUNT_IMPORT_NAME',
        inject: [ConfigService],
        useFactory: (cs: ConfigService) => ({
          name: cs.get<string>('QUEUE_ACCOUNT_IMPORT', 'account-import'),
        }),
      },
      {
        name: 'QUEUE_MEDIA_PROCESSING_NAME',
        inject: [ConfigService],
        useFactory: (cs: ConfigService) => ({
          name: cs.get<string>('QUEUE_MEDIA_PROCESSING', 'media-processing'),
        }),
      },
      {
        name: 'QUEUE_TRANSCRIPTION_NAME',
        inject: [ConfigService],
        useFactory: (cs: ConfigService) => ({
          name: cs.get<string>('QUEUE_TRANSCRIPTION', 'transcription'),
        }),
      },
      {
        name: 'QUEUE_REPORT_EXPORT_NAME',
        inject: [ConfigService],
        useFactory: (cs: ConfigService) => ({
          name: cs.get<string>('QUEUE_REPORT_EXPORT', 'report-export'),
        }),
      },
      {
        name: 'QUEUE_MINUTES_EXPORT_NAME',
        inject: [ConfigService],
        useFactory: (cs: ConfigService) => ({
          name: cs.get<string>('QUEUE_MINUTES_EXPORT', 'minutes-export'),
        }),
      },
      {
        name: 'QUEUE_SCHEDULER_NAME',
        inject: [ConfigService],
        useFactory: (cs: ConfigService) => ({
          name: cs.get<string>('QUEUE_SCHEDULER', 'scheduler'),
        }),
      },
      {
        name: 'QUEUE_MINUTES_AI_DRAFT_NAME',
        inject: [ConfigService],
        useFactory: (cs: ConfigService) => ({
          name: cs.get<string>(
            'QUEUE_MINUTES_AI_DRAFT',
            'minutes.generate_ai_draft',
          ),
        }),
      },
    ),
  ],
  providers: [QueueService],
  exports: [BullModule, QueueService],
})
export class QueueModule {}
