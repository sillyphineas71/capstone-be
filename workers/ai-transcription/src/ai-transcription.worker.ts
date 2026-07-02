import { loadProfile } from './profile-config';

interface TranscriptionJob {
  backgroundJobId: string;
  transcriptId: string;
  meetingId: string;
  recordingSessionId: string;
  sourceMediaFileId: string;
  language: string;
  speakerMappingMode: string;
  userId: string;
}

export async function processTranscriptionJob(job: TranscriptionJob): Promise<void> {
  const profile = loadProfile();
  console.error(JSON.stringify({
    event: 'job_start',
    jobId: job.backgroundJobId,
    aiProfile: profile.profile,
    whisperModel: profile.whisperModel,
    device: profile.whisperDevice,
    computeType: profile.whisperComputeType,
    diarizationEnabled: profile.diarizationEnabled,
    separationEnabled: profile.separationEnabled,
  }));
  // Actual processing delegated to Python pipeline
}