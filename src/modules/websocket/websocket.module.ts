import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventsGateway } from './events.gateway.js';
import { WebsocketService } from './websocket.service.js';

/**
 * WebsocketModule — Skeleton cho WebSocket gateway.
 *
 * Sử dụng Socket.IO via @nestjs/platform-socket.io.
 * Path và CORS lấy từ env (WS_PATH, WS_CORS_ORIGIN).
 *
 * WebsocketService cung cấp:
 * - emitToRoom(room, event, data) — broadcast đến một room
 * - emitToUser(userId, event, data) — broadcast đến user cụ thể
 *
 * TODO: Implement business realtime events (meeting status, presence, ...) khi cần.
 */
@Module({
  imports: [ConfigModule],
  providers: [EventsGateway, WebsocketService],
  exports: [WebsocketService],
})
export class WebsocketModule {}
