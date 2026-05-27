import { IsUUID, IsNotEmpty } from 'class-validator';
import { Expose } from 'class-transformer';

export class AssignRoomDto {
  @Expose({ name: 'room_id' })
  @IsNotEmpty()
  @IsUUID()
  roomId: string;
}
