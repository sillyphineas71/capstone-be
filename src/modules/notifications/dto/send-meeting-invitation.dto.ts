import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class SendMeetingInvitationDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['email', 'in_app'], { each: true })
  channels: ('email' | 'in_app')[];

  @IsOptional()
  @IsBoolean()
  includeAgenda?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
