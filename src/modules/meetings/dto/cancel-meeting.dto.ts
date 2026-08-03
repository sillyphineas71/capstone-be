import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CancelMeetingDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  cancellationReason?: string;

  // Alias cua `cancellationReason` — FE dang gui field `reason`. Route cancel bat
  // forbidNonWhitelisted nen thieu field nay se 400. Uu tien `cancellationReason`.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason?: string;
}
