export interface TranscriptSegment {
  segmentId: string;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel: string;
  speakerSource: 'pyannote' | 'channel_zone' | 'sepformer' | 'unknown';
  userId: string | null;
  channelId: string | null;
  roomZoneLabel: string | null;
  sttConfidence: number | null;
  diarizationConfidence: number | null;
  separationConfidence: number | null;
  finalConfidence: number;
  overlap: boolean;
  lowConfidence: boolean;
  manualReviewRequired: boolean;
  notes: string[];
}

export interface DetectedSpeaker {
  speakerLabel: string;
  totalSpeakingMs: number;
  segmentCount: number;
  mappedUserId: string | null;
  mappingSource: 'diarization' | 'channel_zone' | 'manual' | 'unmapped';
  confidence: number;
}

export interface TranscriptionResult {
  languageCode: string;
  rawText: string;
  cleanedText: string;
  confidenceScore: number;
  segments: TranscriptSegment[];
  detectedSpeakers: DetectedSpeaker[];
  modelVersions: {
    whisper: string;
    pyannote: string | null;
    sepformer: string | null;
  };
  warnings: string[];
}
