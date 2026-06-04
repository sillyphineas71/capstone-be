import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PresenceSnapshotEntity } from './entities/presence-snapshot.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';

@Module({
  imports: [
    AccountsModule,
    MeetingsModule,
    RoomsModule,
    TypeOrmModule.forFeature([PresenceSnapshotEntity]),
  ],
  exports: [TypeOrmModule],
})
export class PresenceModule {}
