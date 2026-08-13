import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { EquipmentEntity } from './entities/equipment.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { EquipmentController } from './controllers/equipment.controller.js';
import { EquipmentService } from './services/equipment.service.js';

@Module({
  imports: [
    AccountsModule,
    RoomsModule,
    AuthModule,
    NotificationsModule,
    JwtModule.register({}),
    TypeOrmModule.forFeature([EquipmentEntity]),
  ],
  controllers: [EquipmentController],
  providers: [EquipmentService],
  exports: [TypeOrmModule],
})
export class EquipmentModule {}
