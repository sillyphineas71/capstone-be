import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
} from 'class-validator';

export class SendMeetingReminderDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['email', 'in_app'], { each: true })
  channels: ('email' | 'in_app')[];

  @IsString()
  @IsIn(['manual', 'scheduled'])
  reminderType: 'manual' | 'scheduled';

  @IsOptional()
  @IsISO8601({ strict: true })
  sendAt?: string;
}
