import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TranscriptEntity } from './entities/transcript.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { RecordingModule } from '../recording/recording.module.js';

@Module({
  imports: [
    AccountsModule,
    MeetingsModule,
    RecordingModule,
    TypeOrmModule.forFeature([TranscriptEntity]),
  ],
  exports: [TypeOrmModule],
})
export class TranscriptionModule {}
