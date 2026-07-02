import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDraftMinutesDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}
