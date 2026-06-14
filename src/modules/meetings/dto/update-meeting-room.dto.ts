import {
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsBoolean,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateMeetingRoomDto {
  @IsNotEmpty()
  @IsUUID('4')
  newRoomId: string;

  @IsOptional()
  @IsBoolean()
  confirmCapacityOverride: boolean = false;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeReason?: string;
}
