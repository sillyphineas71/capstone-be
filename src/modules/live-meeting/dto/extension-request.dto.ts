import {
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Request DTO cho UC-IMM-02 Yêu cầu gia hạn phiên họp.
 */
export class ExtensionRequestDto {
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  extensionMinutes: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
