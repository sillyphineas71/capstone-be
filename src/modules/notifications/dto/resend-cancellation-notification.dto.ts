import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ResendCancellationNotificationDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['email', 'in_app'], { each: true })
  channels: ('email' | 'in_app')[];
}
