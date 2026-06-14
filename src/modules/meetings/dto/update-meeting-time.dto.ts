import {
  IsNotEmpty,
  IsISO8601,
  IsOptional,
  IsUUID,
  IsBoolean,
  MaxLength,
} from 'class-validator';

export class UpdateMeetingTimeDto {
  @IsNotEmpty()
  @IsISO8601({ strict: true })
  startTime: string;

  @IsNotEmpty()
  @IsISO8601({ strict: true })
  endTime: string;

  @IsOptional()
  @IsUUID()
  newRoomId?: string;

  @IsOptional()
  @IsBoolean()
  overrideParticipantConflict?: boolean;

  @IsOptional()
  @MaxLength(500)
  changeReason?: string;
}
