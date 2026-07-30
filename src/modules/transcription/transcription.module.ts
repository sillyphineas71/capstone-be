// Việc #4 (2026-07-29): file này đọc process.env.TRANSCRIPTION_WORKER_ENABLED
// NGAY tại thời điểm module này được load (bên trong mảng `providers` của
// @Module — đánh giá đồng bộ lúc import, không phải lúc DI runtime). Nhưng
// app.module.ts chỉ gọi ConfigModule.forRoot() (nơi thực sự nạp file .env
// qua dotenv) SAU KHI đã import xong TranscriptionModule — vì import ở đầu
// file luôn thực thi trước phần thân/decorator của file đang import nó.
// Nói cách khác: nếu không tự nạp dotenv ở đây, biến chỉ đặt trong .env
// (không phải biến môi trường hệ điều hành thật) sẽ KHÔNG kịp có mặt trong
// process.env khi dòng `providers: [...]` bên dưới được đánh giá — cờ coi
// như vô tác dụng. Gọi lại dotenv.config() ở đây là an toàn/không phá gì:
// nó không ghi đè biến đã có sẵn trong process.env, và ConfigModule.forRoot()
// gọi lại lần nữa sau đó cũng chỉ là no-op trên các biến đã được nạp.
import 'dotenv/config';

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
// Việc #4 (2026-07-29): mặc định BẬT (chỉ tắt khi set rõ 'false') để không
// phá môi trường dev/test hiện có. Set 'false' trên các instance KHÔNG được
// phép tự xử lý job STT (VD: EC2 khi worker thật chạy trên máy cá nhân qua
// Tailscale) — tránh 2 instance cùng giành job trên cùng queue 'transcription'.
const isWorkerEnabled = process.env['TRANSCRIPTION_WORKER_ENABLED'] !== 'false';

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
  providers: [
    TranscriptionService,
    ...(isWorkerEnabled ? [TranscriptionWorkerProcessor] : []),
  ],
  exports: [TypeOrmModule, TranscriptionService],
})
export class TranscriptionModule {}
