import { RoomStatus } from '../entities/room.entity.js';

export class UpdateRoomAdministrativeStatusResponseDto {
  roomId: string;
  administrativeStatus: RoomStatus;
  updatedAt: Date;

  constructor(partial: UpdateRoomAdministrativeStatusResponseDto) {
    Object.assign(this, partial);
  }
}
