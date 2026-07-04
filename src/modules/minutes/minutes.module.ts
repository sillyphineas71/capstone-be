import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { MeetingMinutesEntity } from './entities/meeting-minutes.entity.js';
import { MediaFileEntity } from '../recording/entities/media-file.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { RecordingModule } from '../recording/recording.module.js';
import { TranscriptionModule } from '../transcription/transcription.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { MinutesController } from './controllers/minutes.controller.js';
import { MeetingMinutesListController } from './controllers/minutes-list.controller.js';
import { MinutesService } from './services/minutes.service.js';

@Module({
  imports: [
    ConfigModule,
    AccountsModule,
    MeetingsModule,
    RecordingModule,
    TranscriptionModule,
    AuthModule,
    StorageModule,
    TypeOrmModule.forFeature([MeetingMinutesEntity, MediaFileEntity]),
  ],
  controllers: [MinutesController, MeetingMinutesListController],
  providers: [MinutesService],
  exports: [TypeOrmModule],
})
export class MinutesModule {}
