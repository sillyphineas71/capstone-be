import { spawn } from 'child_process';

/**
 * ffprobe.util (REC-005) — trích metadata media (best-effort, ASYNC).
 *
 * SEC-01: filePath KHÔNG chứa credential (khác RTSP url) → an toàn. KHÔNG log nội dung file.
 * Mọi lỗi (spawn/exit/parse/timeout/không có video stream) → resolve(null), KHÔNG ném —
 * để finalize recording (REC-003/004) không bao giờ hỏng vì ffprobe.
 */

export interface MediaProbe {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  fps: number | null;
  bitrate: number | null;
}

/** Hằng số timeout ffprobe để không treo finalize. */
export const FFPROBE_TIMEOUT_MS = 10000;

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  bit_rate?: string;
}
interface FfprobeJson {
  format?: { duration?: string; bit_rate?: string };
  streams?: FfprobeStream[];
}

/** 'num/den' → round(num/den, 2); den=0 hoặc thiếu/không hợp lệ → null. */
export function parseFps(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.split('/');
  if (parts.length !== 2) return null;
  const num = Number(parts[0]);
  const den = Number(parts[1]);
  if (!den || Number.isNaN(num) || Number.isNaN(den)) return null;
  return Math.round((num / den) * 100) / 100;
}

function parseProbeJson(raw: string): MediaProbe | null {
  let json: FfprobeJson;
  try {
    json = JSON.parse(raw) as FfprobeJson;
  } catch {
    return null;
  }
  const video = (json.streams ?? []).find((s) => s.codec_type === 'video');
  if (!video) return null;

  const durationStr = json.format?.duration;
  const durationNum = durationStr != null ? Number(durationStr) : NaN;
  const durationSeconds =
    Number.isFinite(durationNum) && durationNum > 0
      ? Math.round(durationNum)
      : null;

  const bitrateStr = video.bit_rate ?? json.format?.bit_rate;
  const bitrateNum = bitrateStr != null ? Number(bitrateStr) : NaN;

  return {
    durationSeconds,
    width: typeof video.width === 'number' ? video.width : null,
    height: typeof video.height === 'number' ? video.height : null,
    videoCodec: video.codec_name ?? null,
    fps: parseFps(video.avg_frame_rate),
    bitrate: Number.isFinite(bitrateNum) ? bitrateNum : null,
  };
}

/**
 * Chạy ffprobe (`-v quiet -print_format json -show_format -show_streams`) trên file,
 * parse JSON → MediaProbe. Best-effort: lỗi/timeout → null. KHÔNG ném.
 */
export function probeMedia(filePath: string): Promise<MediaProbe | null> {
  const bin = process.env.FFPROBE_PATH || 'ffprobe';
  const args = [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  return new Promise((resolve) => {
    let settled = false;
    const done = (r: MediaProbe | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    let stdout = '';
    const proc = spawn(bin, args, { windowsHide: true });

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // process có thể đã thoát.
      }
      done(null);
    }, FFPROBE_TIMEOUT_MS);

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.on('error', () => done(null));
    proc.on('close', (code) => {
      if (code !== 0) return done(null);
      done(parseProbeJson(stdout));
    });
  });
}
