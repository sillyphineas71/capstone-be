import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { probeMedia, parseFps } from './ffprobe.util.js';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
const spawnMock = spawn as unknown as jest.Mock;

class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  kill = jest.fn();
}

const VALID_JSON = JSON.stringify({
  format: { duration: '81.5', bit_rate: '4096000' },
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      avg_frame_rate: '25/1',
      bit_rate: '4000000',
    },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
});

describe('parseFps (REC-005)', () => {
  it('25/1 → 25', () => expect(parseFps('25/1')).toBe(25));
  it('30000/1001 → ~29.97', () => expect(parseFps('30000/1001')).toBe(29.97));
  it('0/0 → null', () => expect(parseFps('0/0')).toBeNull());
  it('undefined → null', () => expect(parseFps(undefined)).toBeNull());
  it('no slash → null', () => expect(parseFps('24')).toBeNull());
});

describe('probeMedia (REC-005)', () => {
  let fake: FakeProc;
  beforeEach(() => {
    fake = new FakeProc();
    spawnMock.mockReturnValue(fake);
  });
  afterEach(() => jest.clearAllMocks());

  it('JSON hợp lệ → parse duration/width/height/codec/fps/bitrate', async () => {
    const p = probeMedia('/rec/s1.mp4');
    fake.stdout.emit('data', Buffer.from(VALID_JSON));
    fake.emit('close', 0);
    const r = await p;
    expect(r).not.toBeNull();
    expect(r!.durationSeconds).toBe(82); // round(81.5)
    expect(r!.width).toBe(1920);
    expect(r!.height).toBe(1080);
    expect(r!.videoCodec).toBe('h264');
    expect(r!.fps).toBe(25);
    expect(r!.bitrate).toBe(4000000);
  });

  it('exit code != 0 → null', async () => {
    const p = probeMedia('/rec/s1.mp4');
    fake.emit('close', 1);
    expect(await p).toBeNull();
  });

  it("'error' event → null", async () => {
    const p = probeMedia('/rec/s1.mp4');
    fake.emit('error', new Error('ENOENT'));
    expect(await p).toBeNull();
  });

  it('JSON hỏng → null', async () => {
    const p = probeMedia('/rec/s1.mp4');
    fake.stdout.emit('data', Buffer.from('not-json{'));
    fake.emit('close', 0);
    expect(await p).toBeNull();
  });

  it('không có video stream → null', async () => {
    const p = probeMedia('/rec/s1.mp4');
    fake.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          format: { duration: '10' },
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
        }),
      ),
    );
    fake.emit('close', 0);
    expect(await p).toBeNull();
  });

  it('duration thiếu/N-A → durationSeconds null (vẫn parse video)', async () => {
    const p = probeMedia('/rec/s1.mp4');
    fake.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          format: {},
          streams: [
            { codec_type: 'video', codec_name: 'h264', avg_frame_rate: '0/0' },
          ],
        }),
      ),
    );
    fake.emit('close', 0);
    const r = await p;
    expect(r).not.toBeNull();
    expect(r!.durationSeconds).toBeNull();
    expect(r!.fps).toBeNull();
  });

  it('timeout → kill + null', async () => {
    jest.useFakeTimers();
    const p = probeMedia('/rec/s1.mp4');
    jest.advanceTimersByTime(10001);
    jest.useRealTimers();
    expect(fake.kill).toHaveBeenCalled();
    expect(await p).toBeNull();
  });
});
