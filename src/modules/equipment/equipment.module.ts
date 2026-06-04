import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EquipmentEntity } from './entities/equipment.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';

@Module({
  imports: [
    AccountsModule,
    RoomsModule,
    TypeOrmModule.forFeature([EquipmentEntity]),
  ],
  exports: [TypeOrmModule],
})
export class EquipmentModule {}
