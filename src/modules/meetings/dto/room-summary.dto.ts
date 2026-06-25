import { Expose } from 'class-transformer';

export class RoomSummaryDto {
  @Expose()
  id: string;

  @Expose()
  roomName: string;

  constructor(id: string, roomName: string) {
    this.id = id;
    this.roomName = roomName;
  }
}
