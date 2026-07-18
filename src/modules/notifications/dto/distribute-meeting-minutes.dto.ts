import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class DistributeMeetingMinutesDto {
  @IsUUID()
  minutesId: string;

  @IsString()
  @IsIn(['participants', 'custom'])
  recipientScope: 'participants' | 'custom';

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  recipientUserIds?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['email', 'in_app'], { each: true })
  channels: ('email' | 'in_app')[];

  @IsOptional()
  @IsString()
  message?: string;
}
