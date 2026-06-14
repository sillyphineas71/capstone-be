import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingMinutesEntity } from './entities/meeting-minutes.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { RecordingModule } from '../recording/recording.module.js';
import { TranscriptionModule } from '../transcription/transcription.module.js';

@Module({
  imports: [
    AccountsModule,
    MeetingsModule,
    RecordingModule,
    TranscriptionModule,
    TypeOrmModule.forFeature([MeetingMinutesEntity]),
  ],
  exports: [TypeOrmModule],
})
export class MinutesModule {}
