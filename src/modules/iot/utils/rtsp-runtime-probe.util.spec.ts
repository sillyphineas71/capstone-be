import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { probeRtspRuntime } from './rtsp-runtime-probe.util.js';

jest.mock('child_process', () => ({ spawn: jest.fn() }));

const spawnMock = spawn as unknown as jest.Mock;

class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = jest.fn();
}

/** Đăng ký 1 lần spawn → tạo FakeProc, chạy `driver` sau khi listener đã gắn (nextTick). */
function mockSpawnOnce(driver: (proc: FakeProc) => void): FakeProc {
  const proc = new FakeProc();
  spawnMock.mockImplementationOnce(() => {
    process.nextTick(() => driver(proc));
    return proc;
  });
  return proc;
}

const URL = 'rtsp://admin:secretpass@10.0.0.5:554/stream1';
const emitStdout = (p: FakeProc, obj: unknown) =>
  p.stdout.emit('data', Buffer.from(JSON.stringify(obj)));
const emitStderr = (p: FakeProc, s: string) =>
  p.stderr.emit('data', Buffer.from(s));

describe('probeRtspRuntime (A5 / spec §8.2 taxonomy)', () => {
  beforeEach(() => spawnMock.mockReset());

  it('Alive: exit 0 + có video stream → online/healthy', async () => {
    mockSpawnOnce((p) => {
      emitStdout(p, { streams: [{ codec_type: 'video', codec_name: 'h264' }] });
      p.emit('close', 0);
    });
    const r = await probeRtspRuntime(URL, 5000);
    expect(r.group).toBe('alive');
    expect(r.reasonCode).toBeNull();
    expect(r.isAvailable).toBe(true);
    expect(r.runtimeVerified).toBe(true);
    expect(r.healthStatus).toBe('healthy');
    expect(r.statusAction).toBe('set_online');
  });

  it('Auth fail: stderr 401 Unauthorized → warning/keep', async () => {
    mockSpawnOnce((p) => {
      emitStderr(
        p,
        '401 Unauthorized\nServer returned 401 Unauthorized (authorization failed)',
      );
      p.emit('close', 1);
    });
    const r = await probeRtspRuntime(URL, 5000);
    expect(r.group).toBe('auth_fail');
    expect(r.reasonCode).toBe('RTSP_AUTH_FAILED');
    expect(r.isAvailable).toBe(false);
    expect(r.healthStatus).toBe('warning');
    expect(r.statusAction).toBe('keep');
  });

  it('Unreachable: stderr Connection refused → faulty/set_offline', async () => {
    mockSpawnOnce((p) => {
      emitStderr(p, 'Connection refused');
      p.emit('close', 1);
    });
    const r = await probeRtspRuntime(URL, 5000);
    expect(r.group).toBe('unreachable');
    expect(r.reasonCode).toBe('RTSP_UNREACHABLE');
    expect(r.statusAction).toBe('set_offline');
    expect(r.healthStatus).toBe('faulty');
  });

  it('Timeout: không close → kill → set_offline/RTSP_PROBE_TIMEOUT', async () => {
    const proc = mockSpawnOnce(() => {
      /* không emit gì → để timer bắn */
    });
    const r = await probeRtspRuntime(URL, 20);
    expect(r.group).toBe('timeout');
    expect(r.reasonCode).toBe('RTSP_PROBE_TIMEOUT');
    expect(r.statusAction).toBe('set_offline');
    expect(proc.kill).toHaveBeenCalled();
  });

  it('Not-a-stream (stderr): Invalid data found → warning/keep', async () => {
    mockSpawnOnce((p) => {
      emitStderr(p, 'Invalid data found when processing input');
      p.emit('close', 1);
    });
    const r = await probeRtspRuntime(URL, 5000);
    expect(r.group).toBe('not_a_stream');
    expect(r.reasonCode).toBe('RTSP_INVALID_STREAM');
    expect(r.healthStatus).toBe('warning');
  });

  it('Not-a-stream (exit 0 nhưng không có video): audio-only → not_a_stream', async () => {
    mockSpawnOnce((p) => {
      emitStdout(p, { streams: [{ codec_type: 'audio', codec_name: 'aac' }] });
      p.emit('close', 0);
    });
    const r = await probeRtspRuntime(URL, 5000);
    expect(r.group).toBe('not_a_stream');
  });

  it('Tool-unavailable: spawn error ENOENT → unknown/keep, runtimeVerified=false', async () => {
    mockSpawnOnce((p) => {
      const err: NodeJS.ErrnoException = new Error('spawn ffprobe ENOENT');
      err.code = 'ENOENT';
      p.emit('error', err);
    });
    const r = await probeRtspRuntime(URL, 5000);
    expect(r.group).toBe('tool_unavailable');
    expect(r.reasonCode).toBe('PROBE_TOOL_UNAVAILABLE');
    expect(r.runtimeVerified).toBe(false);
    expect(r.healthStatus).toBe('unknown');
    expect(r.statusAction).toBe('keep');
  });

  it('Default (catch-all): exit != 0 + stderr không khớp → RTSP_PROBE_FAILED/faulty', async () => {
    mockSpawnOnce((p) => {
      emitStderr(p, 'some weird unmatched ffprobe error xyz');
      p.emit('close', 1);
    });
    const r = await probeRtspRuntime(URL, 5000);
    expect(r.group).toBe('default');
    expect(r.reasonCode).toBe('RTSP_PROBE_FAILED');
    expect(r.healthStatus).toBe('faulty');
  });

  it('Bảo mật: kết quả KHÔNG chứa stderr thô / URL / credential', async () => {
    mockSpawnOnce((p) => {
      emitStderr(p, `401 Unauthorized for ${URL}`);
      p.emit('close', 1);
    });
    const r = await probeRtspRuntime(URL, 5000);
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain('rtsp://');
    expect(serialized).not.toContain('secretpass');
    expect(serialized).not.toContain('Unauthorized'); // không lộ stderr thô
    expect(r).not.toHaveProperty('stderr');
  });

  it('KHÔNG bao giờ reject (mọi nhánh resolve một group)', async () => {
    mockSpawnOnce((p) => p.emit('close', 255));
    await expect(probeRtspRuntime(URL, 5000)).resolves.toHaveProperty('group');
  });
});
