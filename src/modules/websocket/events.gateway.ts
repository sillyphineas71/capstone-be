import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * EventsGateway — Basic Socket.IO gateway skeleton.
 *
 * Chỉ setup connection lifecycle (connect/disconnect/init).
 * Chưa implement business realtime events.
 *
 * TODO: Thêm event handlers cho:
 * - Meeting status updates
 * - Presence detection events
 * - Room utilization updates
 * - Notification push
 */
@WebSocketGateway({
  path: process.env['WS_PATH'] ?? '/ws',
  cors: {
    origin: (process.env['WS_CORS_ORIGIN'] ?? 'http://localhost:5173,http://localhost:3000')
      .split(',')
      .map((o: string) => o.trim()),
    credentials: true,
  },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(private readonly configService: ConfigService) {}

  afterInit(server: Server): void {
    const wsEnabled = this.configService.get<boolean>('WS_ENABLED', true);
    if (!wsEnabled) {
      this.logger.warn('WS_ENABLED=false — WebSocket gateway initialized but disabled.');
    } else {
      this.logger.log('EventsGateway initialized — WebSocket server ready.');
    }
    void server;
  }

  handleConnection(client: Socket): void {
    this.logger.debug(`[WS] Client connected: ${client.id}`);
    // TODO: Validate JWT nếu WS_AUTH_REQUIRED=true
    // const wsAuthRequired = this.configService.get<boolean>('WS_AUTH_REQUIRED', true);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`[WS] Client disconnected: ${client.id}`);
  }
}
