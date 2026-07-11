import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * CreateAudioSessionDto — body POST /meetings/:meetingId/recording-sessions.
 * Tạo 1 audio recording_session "rỗng" (chưa có media_file nào) để làm điểm neo
 * (sessionId) cho nhiều participant lần lượt upload audio track riêng của mình
 * qua POST .../recording-sessions/:sessionId/audio-tracks (channel_zone mode).
 */
export class CreateAudioSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
