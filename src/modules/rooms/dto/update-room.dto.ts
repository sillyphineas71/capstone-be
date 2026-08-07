import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsEnum,
} from 'class-validator';
import { RoomType } from '../entities/room.entity.js';

export class UpdateRoomDto {
  @IsOptional()
  @IsString({ message: 'roomName phai la chuoi ky tu' })
  @IsNotEmpty({ message: 'roomName khong duoc de trong' })
  @MaxLength(255, { message: 'roomName toi da 255 ky tu' })
  roomName?: string;

  @IsOptional()
  @IsString({ message: 'areaName phai la chuoi ky tu' })
  @IsNotEmpty({ message: 'areaName khong duoc de trong' })
  @MaxLength(255, { message: 'areaName toi da 255 ky tu' })
  areaName?: string;

  @IsOptional()
  @IsString({ message: 'siteName phai la chuoi ky tu' })
  @MaxLength(255, { message: 'siteName toi da 255 ky tu' })
  siteName?: string;

  @IsOptional()
  @IsString({ message: 'locationDescription phai la chuoi ky tu' })
  locationDescription?: string;

  @IsOptional()
  @IsInt({ message: 'capacity phai la so nguyen' })
  @Min(1, { message: 'capacity phai tu 1 tro len' })
  @Max(1000, { message: 'capacity khong duoc vuot qua 1000' })
  capacity?: number;

  @IsOptional()
  @IsEnum(RoomType, {
    message:
      'roomType khong hop le. Gia tri: meeting_room, training_room, board_room, open_space',
  })
  roomType?: RoomType;

  @IsOptional()
  @IsBoolean({ message: 'hasCamera phai la boolean' })
  hasCamera?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'hasMicrophone phai la boolean' })
  hasMicrophone?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'hasDisplay phai la boolean' })
  hasDisplay?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'allowRecording phai la boolean' })
  allowRecording?: boolean;
}
