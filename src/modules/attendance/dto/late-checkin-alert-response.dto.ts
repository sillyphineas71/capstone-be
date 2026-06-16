import { IsUUID, IsString, IsNumber, IsBoolean, IsArray, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class PartialFailureItem {
  @IsUUID()
  userId: string;

  @IsString()
  reason: string;
}

export class LateCheckinAlertResponseDto {
  @IsUUID()
  meetingId: string;

  @IsString()
  status: string;

  @IsNumber()
  totalParticipantsChecked: number;

  @IsNumber()
  alertsSent: number;

  @IsBoolean()
  hostAlertSent: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartialFailureItem)
  @IsOptional()
  partialFailures?: PartialFailureItem[];
}
