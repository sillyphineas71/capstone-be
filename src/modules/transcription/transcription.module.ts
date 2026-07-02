import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TranscriptEntity } from './entities/transcript.entity.js';
import { TranscriptionController } from './transcription.controller.js';
import { TranscriptSegmentsController } from './transcript-segments.controller.js';
import { TranscriptionService } from './transcription.service.js';
import { TranscriptionWorkerProcessor } from './transcription-worker.processor.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { RecordingModule } from '../recording/recording.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';

/**
 * Queue 'transcription' đã được đăng ký bởi QueueModule (Global) ở
 * src/modules/queue/queue.module.ts qua token QUEUE_TRANSCRIPTION_NAME —
 * không đăng ký lại ở đây để tránh tạo thêm 1 BullMQ Queue client trùng lặp
 * trỏ vào cùng queue Redis.
 *
 * AuthModule cần import trực tiếp (không transitive qua MeetingsModule/
 * RecordingModule, vì 2 module đó không re-export AuthModule) — JwtAuthGuard
 * dùng trong TranscriptionController cần JwtService/AuthConfigService từ đây.
 */
@Module({
  imports: [
    AccountsModule,
    MeetingsModule,
    RecordingModule,
    AuthModule,
    NotificationsModule,
    WebsocketModule,
    TypeOrmModule.forFeature([TranscriptEntity]),
  ],
  controllers: [TranscriptionController, TranscriptSegmentsController],
  providers: [TranscriptionService, TranscriptionWorkerProcessor],
  exports: [TypeOrmModule, TranscriptionService],
})
export class TranscriptionModule {}
