import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaFileEntity } from './entities/media-file.entity.js';
import { RecordingConfigEntity } from './entities/recording-config.entity.js';
import { RecordingSessionEntity } from './entities/recording-session.entity.js';
import { RecordingSegmentEntity } from './entities/recording-segment.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { IotModule } from '../iot/iot.module.js';

/**
 * RecordingModule quản lý:
 * - MediaFileEntity (media_files) — định nghĩa trước vì các entity khác reference nó
 * - RecordingConfigEntity (recording_configs)
 * - RecordingSessionEntity (recording_sessions)
 * - RecordingSegmentEntity (recording_segments)
 */
@Module({
  imports: [
    AccountsModule,
    MeetingsModule,
    RoomsModule,
    IotModule,
    TypeOrmModule.forFeature([
      MediaFileEntity,
      RecordingConfigEntity,
      RecordingSessionEntity,
      RecordingSegmentEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class RecordingModule {}
