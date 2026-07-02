import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadAudioTrackDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
