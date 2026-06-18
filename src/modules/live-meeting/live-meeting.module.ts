import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { LiveMeetingService } from './services/live-meeting.service.js';
import { LiveMeetingController } from './controllers/live-meeting.controller.js';

/**
 * LiveMeetingModule quản lý In-Meeting Management:
 * - UC-IMM-01: Bắt đầu phiên họp (Start Meeting Session)
 * - Import AuthModule để dùng JwtAuthGuard, PermissionsGuard
 * - Import WebsocketModule để dùng WebsocketService cho realtime push
 *
 * AdministrationModule là @Global nên AuditLogEntity và services đã có sẵn.
 * Entities từ MeetingsModule và RoomsModule được truy cập qua TypeORM repository.
 */
@Module({
  imports: [
    AuthModule,
    WebsocketModule,
  ],
  controllers: [LiveMeetingController],
  providers: [LiveMeetingService],
  exports: [LiveMeetingService],
})
export class LiveMeetingModule {}
