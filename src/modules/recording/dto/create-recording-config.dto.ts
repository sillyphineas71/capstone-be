import {
  IsOptional,
  IsBoolean,
  IsEnum,
  IsUUID,
  IsInt,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';
import { AudioSourceMode } from '../entities/recording-config.entity.js';

/**
 * CreateRecordingConfigDto (REC-001) — body POST /meetings/:meetingId/recording-config.
 * Tất cả field optional; thiếu → entity default (enable* false, consent true, status 'draft').
 */
export class CreateRecordingConfigDto {
  @IsOptional()
  @IsBoolean()
  enableAudio?: boolean;

  @IsOptional()
  @IsBoolean()
  enableVideo?: boolean;

  @IsOptional()
  @IsBoolean()
  enableTranscription?: boolean;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID('4')
  videoSourceDeviceId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsEnum(AudioSourceMode)
  audioSourceMode?: AudioSourceMode | null;

  @IsOptional()
  @IsBoolean()
  autoStart?: boolean;

  @IsOptional()
  @IsBoolean()
  consentRequired?: boolean;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(365)
  retentionDays?: number | null;
}
