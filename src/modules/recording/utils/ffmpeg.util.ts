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

/**
 * Build args ffmpeg concat demuxer: gộp N segment (cùng codec, `-c copy`) → 1 file.
 * `listPath` là file text mỗi dòng `file '<abs path>'`. Dùng khi stopVideo có nhiều
 * segment do pause/resume (UC-114/115). `-safe 0` cho phép path tuyệt đối.
 */
export function buildConcatArgs(listPath: string, outPath: string): string[] {
  return ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath];
}

/** Spawn ffmpeg concat. FFMPEG_PATH lazy từ env. Path segment/list KHÔNG chứa credential. */
export function spawnFfmpegConcat(
  listPath: string,
  outPath: string,
): ChildProcess {
  const bin = process.env.FFMPEG_PATH || 'ffmpeg';
  return spawn(bin, buildConcatArgs(listPath, outPath), { windowsHide: true });
}
