import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SpeakerMappingMode {
  CHANNEL_ZONE = 'channel_zone',
  DIARIZATION_ONLY = 'diarization_only',
}

export class CreateTranscriptionJobDto {
  @ApiProperty({ description: 'Recording session ID nguồn' })
  @IsUUID('4', { message: 'recordingSessionId phải là UUID hợp lệ' })
  recordingSessionId!: string;

  @ApiPropertyOptional({ description: 'Mã ngôn ngữ', default: 'vi-VN' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({
    description: 'Chế độ mapping speaker',
    enum: SpeakerMappingMode,
    default: SpeakerMappingMode.DIARIZATION_ONLY,
  })
  @IsOptional()
  @IsEnum(SpeakerMappingMode)
  speakerMappingMode?: SpeakerMappingMode;

  @ApiPropertyOptional({
    description: 'Force rerun nếu đã có job processing',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  forceRerun?: boolean;

  @ApiPropertyOptional({
    description:
      'Custom vocabulary (tên riêng, thuật ngữ ngành) gợi ý cho STT — override WHISPER_INITIAL_PROMPT mặc định của AI Worker nếu có.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'initialPrompt không được vượt quá 1000 ký tự' })
  initialPrompt?: string;
}
