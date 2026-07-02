import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IVSS_MEETING_ROOM = (meetingId: string): string =>
  `ivss:meeting:${meetingId}`;
const MEETING_ROOM = (meetingId: string): string => `meeting:${meetingId}`;

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
    origin: (
      process.env['WS_CORS_ORIGIN'] ??
      'http://localhost:5173,http://localhost:3000'
    )
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
      this.logger.warn(
        'WS_ENABLED=false — WebSocket gateway initialized but disabled.',
      );
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

  /**
   * IRP-001 (#40): client subscribe nhận realtime presence của 1 cuộc họp.
   * Room socket.io = ivss:meeting:<meetingId> — khớp emitToRoom phía ingestion.
   * KHÔNG auth ở đây (OWED-BLOCKER C2: WS auth handshake = ticket riêng;
   * realtime presence chỉ bật prod sau khi có auth — gate IVSS_REALTIME_ENABLED OFF mặc định).
   */
  @SubscribeMessage('ivss:subscribe')
  handleIvssSubscribe(
    @MessageBody() body: { meetingId?: string },
    @ConnectedSocket() client: Socket,
  ): { ok: boolean; room?: string } {
    const meetingId = body?.meetingId;
    if (typeof meetingId !== 'string' || !UUID_RE.test(meetingId)) {
      return { ok: false };
    }
    const room = IVSS_MEETING_ROOM(meetingId);
    void client.join(room);
    return { ok: true, room };
  }

  @SubscribeMessage('ivss:unsubscribe')
  handleIvssUnsubscribe(
    @MessageBody() body: { meetingId?: string },
    @ConnectedSocket() client: Socket,
  ): { ok: boolean; room?: string } {
    const meetingId = body?.meetingId;
    if (typeof meetingId !== 'string' || !UUID_RE.test(meetingId)) {
      return { ok: false };
    }
    const room = IVSS_MEETING_ROOM(meetingId);
    void client.leave(room);
    return { ok: true, room };
  }

  @SubscribeMessage('meeting:subscribe')
  handleMeetingSubscribe(
    @MessageBody() body: { meetingId?: string },
    @ConnectedSocket() client: Socket,
  ): { ok: boolean; room?: string } {
    const meetingId = body?.meetingId;
    if (typeof meetingId !== 'string' || !UUID_RE.test(meetingId)) {
      return { ok: false };
    }
    const room = MEETING_ROOM(meetingId);
    void client.join(room);
    return { ok: true, room };
  }

  @SubscribeMessage('meeting:unsubscribe')
  handleMeetingUnsubscribe(
    @MessageBody() body: { meetingId?: string },
    @ConnectedSocket() client: Socket,
  ): { ok: boolean; room?: string } {
    const meetingId = body?.meetingId;
    if (typeof meetingId !== 'string' || !UUID_RE.test(meetingId)) {
      return { ok: false };
    }
    const room = MEETING_ROOM(meetingId);
    void client.leave(room);
    return { ok: true, room };
  }
}
