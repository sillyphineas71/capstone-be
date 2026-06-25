export class CreateRoomResponseDto {
  id: string;
  roomCode: string;
  roomName: string;
  capacity: number;
  currentStatus: string;
  isActive: boolean;
  createdAt: Date;

  constructor(data: CreateRoomResponseDto) {
    Object.assign(this, data);
  }
}
