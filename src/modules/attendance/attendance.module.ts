import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceRecordEntity } from './entities/attendance-record.entity.js';
import { AttendanceEventEntity } from './entities/attendance-event.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';

@Module({
  imports: [
    AccountsModule,
    MeetingsModule,
    RoomsModule,
    TypeOrmModule.forFeature([AttendanceRecordEntity, AttendanceEventEntity]),
  ],
  exports: [TypeOrmModule],
})
export class AttendanceModule {}
