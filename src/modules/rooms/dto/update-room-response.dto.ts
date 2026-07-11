import { RoomStatus, RoomType } from '../entities/room.entity.js';

export class UpdateRoomResponseDto {
  id: string;
  roomCode: string;
  roomName: string;
  siteName: string | null;
  areaName: string | null;
  locationDescription: string | null;
  capacity: number;
  roomType: RoomType;
  currentStatus: RoomStatus;
  hasCamera: boolean;
  hasMicrophone: boolean;
  hasDisplay: boolean;
  allowRecording: boolean;
  isActive: boolean;
  updatedAt: Date;

  constructor(data: UpdateRoomResponseDto) {
    Object.assign(this, data);
  }
}
