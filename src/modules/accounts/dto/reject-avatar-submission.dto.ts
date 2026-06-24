import { IsString, IsNotEmpty, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class RejectAvatarSubmissionDto {
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    // Trim and normalize NFC
    return value.trim().normalize('NFC');
  })
  @IsString()
  @IsNotEmpty({ message: 'Rejection reason is required' })
  @MinLength(1, { message: 'Rejection reason is required' })
  @MaxLength(500, {
    message: 'Rejection reason must not exceed 500 characters',
  })
  reason: string;
}
