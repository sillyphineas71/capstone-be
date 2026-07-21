import { Expose } from 'class-transformer';

export class RoomSummaryDto {
  @Expose()
  id: string;

  @Expose()
  roomName: string;
}
