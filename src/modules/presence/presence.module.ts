import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PresenceSnapshotEntity } from './entities/presence-snapshot.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { RoomCameraController } from './controllers/room-camera.controller.js';
import { OccupancyIngestService } from './services/occupancy-ingest.service.js';
import { OccupancyPersistenceService } from './services/occupancy-persistence.service.js';

/**
 * PresenceModule — presence snapshots + occupancy ingest (OCC-001 / UC-75).
 *
 * OccupancyIngestService dùng `dataSource.manager` (raw, đọc/ghi nhiều bảng:
 * iot_devices, iot_device_events, room_events, presence_snapshots, room_booking_usages,
 * room_bookings, rooms) nên KHÔNG cần forFeature thêm entity. WebsocketModule export
 * WebsocketService cho WS best-effort.
 */
@Module({
  imports: [
    AccountsModule,
    MeetingsModule,
    RoomsModule,
    WebsocketModule,
    TypeOrmModule.forFeature([PresenceSnapshotEntity]),
  ],
  controllers: [RoomCameraController],
  providers: [OccupancyIngestService, OccupancyPersistenceService],
  exports: [TypeOrmModule, OccupancyPersistenceService],
})
export class PresenceModule {}
