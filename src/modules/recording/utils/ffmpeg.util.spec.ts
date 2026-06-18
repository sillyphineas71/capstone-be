import { spawn } from 'child_process';
import { buildFfmpegArgs, redactUrl, spawnFfmpeg } from './ffmpeg.util.js';

jest.mock('child_process', () => ({
  spawn: jest.fn(() => ({ pid: 123 })),
}));
const spawnMock = spawn as unknown as jest.Mock;

describe('ffmpeg.util (REC-002)', () => {
  it('buildFfmpegArgs: đúng thứ tự RTSP tcp → map video-only → copy → mp4', () => {
    const args = buildFfmpegArgs('rtsp://h:554/live', '/out/x.mp4');
    expect(args).toEqual([
      '-rtsp_transport',
      'tcp',
      '-i',
      'rtsp://h:554/live',
      '-map',
      '0:v:0',
      '-c',
      'copy',
      '-movflags',
      '+frag_keyframe+empty_moov',
      '-f',
      'mp4',
      '/out/x.mp4',
    ]);
  });

  it('redactUrl: ẩn user:pass@', () => {
    expect(redactUrl('rtsp://admin:secret@10.0.0.5:554/live')).toBe(
      'rtsp://***@10.0.0.5:554/live',
    );
  });

  it('redactUrl: URL không cred giữ nguyên', () => {
    expect(redactUrl('rtsp://10.0.0.5:554/live')).toBe(
      'rtsp://10.0.0.5:554/live',
    );
  });

  it('redactUrl: ẩn cred trong câu log dài', () => {
    const s = 'ffmpeg failed for rtsp://u:p@host/path more text';
    expect(redactUrl(s)).toBe(
      'ffmpeg failed for rtsp://***@host/path more text',
    );
  });

  it('spawnFfmpeg: gọi spawn với FFMPEG_PATH + args + windowsHide', () => {
    const OLD = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = '/usr/bin/ffmpeg';
    spawnMock.mockClear();
    spawnFfmpeg('rtsp://h/live', '/o.mp4');
    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/bin/ffmpeg',
      buildFfmpegArgs('rtsp://h/live', '/o.mp4'),
      { windowsHide: true },
    );
    process.env.FFMPEG_PATH = OLD;
  });
});
