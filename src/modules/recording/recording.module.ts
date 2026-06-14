import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaFileEntity } from './entities/media-file.entity.js';
import { RecordingConfigEntity } from './entities/recording-config.entity.js';
import { RecordingSessionEntity } from './entities/recording-session.entity.js';
import { RecordingSegmentEntity } from './entities/recording-segment.entity.js';

/**
 * RecordingModule quản lý:
 * - MediaFileEntity (media_files) — định nghĩa trước vì các entity khác reference nó
 * - RecordingConfigEntity (recording_configs)
 * - RecordingSessionEntity (recording_sessions)
 * - RecordingSegmentEntity (recording_segments)
 *
 * Module này KHÔNG import các business module khác (AccountsModule, MeetingsModule,
 * RoomsModule, IotModule) để tránh circular dependency.
 * Nó chỉ đăng ký entities và export TypeOrmModule.
 * Entity relations được TypeORM resolve tự động qua decorators.
 */
@Module({
  imports: [
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
