import { RecordingConfigEntity } from '../entities/recording-config.entity.js';

/**
 * Response DTO (REC-001) — camelCase theo entity, nhất quán API Contract recording-config.
 */
export class RecordingConfigResponseDto {
  id: string;
  meetingId: string;
  enableAudio: boolean;
  enableVideo: boolean;
  enableTranscription: boolean;
  videoSourceDeviceId: string | null;
  audioSourceMode: string | null;
  autoStart: boolean;
  consentRequired: boolean;
  retentionDays: number | null;
  status: string;
  configuredBy: string | null;
  configuredAt: Date;
}

export function toRecordingConfigResponse(
  entity: RecordingConfigEntity,
): RecordingConfigResponseDto {
  return {
    id: entity.id,
    meetingId: entity.meetingId,
    enableAudio: entity.enableAudio,
    enableVideo: entity.enableVideo,
    enableTranscription: entity.enableTranscription,
    videoSourceDeviceId: entity.videoSourceDeviceId,
    audioSourceMode: entity.audioSourceMode,
    autoStart: entity.autoStart,
    consentRequired: entity.consentRequired,
    retentionDays: entity.retentionDays,
    status: entity.status,
    configuredBy: entity.configuredBy,
    configuredAt: entity.configuredAt,
  };
}
