import * as os from 'os';
import { loadProfile } from './profile-config';

export interface ResourceGuardResult {
  allowed: boolean;
  skipSepformer: boolean;
  warnings: string[];
}

export function checkResources(audioDurationSeconds: number): ResourceGuardResult {
  const profile = loadProfile();
  const warnings: string[] = [];
  let skipSepformer = false;

  if (profile.profile === 'local' && audioDurationSeconds > profile.maxAudioDurationLocalSeconds) {
    return {
      allowed: false,
      skipSepformer: false,
      warnings: ['AUDIO_TOO_LONG_FOR_LOCAL_PROFILE'],
    };
  }

  const freeRamMb = os.freemem() / (1024 * 1024);
  if (freeRamMb < profile.minFreeRamMb) {
    skipSepformer = true;
    warnings.push('sepformer_skipped_low_resources');
  }

  return { allowed: true, skipSepformer, warnings };
}