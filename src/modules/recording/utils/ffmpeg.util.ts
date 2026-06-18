import { spawn, ChildProcess } from 'child_process';

/**
 * ffmpeg.util (REC-002) — helper spawn ffmpeg ghi RTSP → mp4.
 *
 * SEC-01: TUYỆT ĐỐI không log url/args (chứa credential). Mọi chuỗi có thể chứa
 * `rtsp://user:pass@...` phải đi qua redactUrl() trước khi log/lưu.
 */

/**
 * Build args ffmpeg: RTSP (tcp) → copy codec → fragmented mp4 (VIDEO-ONLY).
 *
 * `-map 0:v:0` chỉ lấy luồng video đầu tiên, loại audio. Camera RTSP có thể kèm
 * audio pcm_alaw (G.711) — container mp4 KHÔNG chứa được pcm_alaw khi `-c copy`,
 * khiến ffmpeg lỗi header và thoát ngay. Ghi kèm audio (transcode aac) là tương
 * lai, ngoài scope #23b.
 */
export function buildFfmpegArgs(url: string, outPath: string): string[] {
  return [
    '-rtsp_transport',
    'tcp',
    '-i',
    url,
    '-map',
    '0:v:0',
    '-c',
    'copy',
    '-movflags',
    '+frag_keyframe+empty_moov',
    '-f',
    'mp4',
    outPath,
  ];
}

/** Ẩn credential trong chuỗi: `//user:pass@host` → `//***@host`. */
export function redactUrl(s: string): string {
  return s.replace(/\/\/[^@/\s]+@/g, '//***@');
}

/** Spawn ffmpeg. FFMPEG_PATH đọc lazy từ env (default 'ffmpeg'). */
export function spawnFfmpeg(url: string, outPath: string): ChildProcess {
  const bin = process.env.FFMPEG_PATH || 'ffmpeg';
  return spawn(bin, buildFfmpegArgs(url, outPath), { windowsHide: true });
}
