/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { EventEmitter } from 'events';
import { DataSource } from 'typeorm';
import { RecordingProcessManager } from './recording-process-manager.js';
import * as ffmpegUtil from '../utils/ffmpeg.util.js';

// Fake ChildProcess: EventEmitter + stderr emitter + stdin/kill + exitCode/killed
class FakeProc extends EventEmitter {
  stderr = new EventEmitter();
  stdin = { write: jest.fn() };
  exitCode: number | null = null;
  killed = false;
  kill = jest.fn(() => {
    this.killed = true;
    return true;
  });
}

describe('RecordingProcessManager (REC-002)', () => {
  let manager: RecordingProcessManager;
  let dataSourceMock: any;
  let fake: FakeProc;
  let spawnSpy: jest.SpyInstance;

  beforeEach(() => {
    dataSourceMock = {
      manager: { update: jest.fn().mockResolvedValue(undefined) },
    };
    manager = new RecordingProcessManager(dataSourceMock as DataSource);
    fake = new FakeProc();
    spawnSpy = jest
      .spyOn(ffmpegUtil, 'spawnFfmpeg')
      .mockReturnValue(fake as any);
  });

  afterEach(() => spawnSpy.mockRestore());

  it('start: spawn + has/get', () => {
    manager.start('s1', 'rtsp://u:p@h/live', '/out/s1.mp4');
    expect(spawnSpy).toHaveBeenCalledWith('rtsp://u:p@h/live', '/out/s1.mp4');
    expect(manager.has('s1')).toBe(true);
    expect(manager.get('s1')).toBe(fake);
  });

  it('waitForGrace: alive nếu không exit trong window', async () => {
    manager.start('s1', 'url', '/o.mp4');
    const r = await manager.waitForGrace('s1', 30);
    expect(r).toBe('alive');
  });

  it('waitForGrace: dead nếu exit trong window', async () => {
    manager.start('s1', 'url', '/o.mp4');
    const p = manager.waitForGrace('s1', 1000);
    fake.emit('exit', 1);
    expect(await p).toBe('dead');
  });

  it('exit ngoài ý muốn → markFailed (update status=failed) + redact stderr', async () => {
    manager.start('s1', 'url', '/o.mp4');
    fake.stderr.emit(
      'data',
      Buffer.from('err rtsp://admin:secret@h/live boom'),
    );
    fake.emit('exit', 1);
    await new Promise((r) => setImmediate(r));

    expect(dataSourceMock.manager.update).toHaveBeenCalledWith(
      expect.anything(),
      's1',
      expect.objectContaining({ status: 'failed' }),
    );
    const arg = dataSourceMock.manager.update.mock.calls[0][2];
    expect(arg.errorMessage).not.toContain('secret');
    expect(arg.errorMessage).toContain('***');
    expect(manager.has('s1')).toBe(false); // đã delete
  });

  it('markStopping → exit KHÔNG markFailed', async () => {
    manager.start('s1', 'url', '/o.mp4');
    manager.markStopping('s1');
    fake.emit('exit', 0);
    await new Promise((r) => setImmediate(r));
    expect(dataSourceMock.manager.update).not.toHaveBeenCalled();
  });

  it("'error' event → markFailed (redact)", async () => {
    manager.start('s1', 'url', '/o.mp4');
    fake.emit('error', new Error('spawn ENOENT rtsp://u:pw@h'));
    await new Promise((r) => setImmediate(r));
    expect(dataSourceMock.manager.update).toHaveBeenCalled();
    const arg = dataSourceMock.manager.update.mock.calls[0][2];
    expect(arg.errorMessage).not.toContain('pw@');
  });

  // ─── REC-003: stop() ───
  it('stop: ghi q → exit → exited + dọn Map (KHÔNG markFailed)', async () => {
    manager.start('s1', 'url', '/o.mp4');
    const p = manager.stop('s1');
    expect(fake.stdin.write).toHaveBeenCalledWith('q');
    fake.emit('exit', 0);
    expect(await p).toBe('exited');
    expect(manager.has('s1')).toBe(false);
    expect(dataSourceMock.manager.update).not.toHaveBeenCalled();
  });

  it('stop: không còn handle → orphan', async () => {
    expect(await manager.stop('nope')).toBe('orphan');
  });

  it('stop: process đã exit trước → exited ngay', async () => {
    manager.start('s1', 'url', '/o.mp4');
    fake.exitCode = 0; // đã thoát
    expect(await manager.stop('s1')).toBe('exited');
    expect(manager.has('s1')).toBe(false);
  });

  it('stop: quá timeout → SIGKILL → killed', async () => {
    jest.useFakeTimers();
    manager.start('s1', 'url', '/o.mp4');
    const p = manager.stop('s1', 50);
    jest.advanceTimersByTime(60); // kích hoạt timeout → kill
    expect(fake.kill).toHaveBeenCalledWith('SIGKILL');
    fake.emit('exit', null); // process thoát sau khi bị kill
    jest.useRealTimers();
    expect(await p).toBe('killed');
    expect(manager.has('s1')).toBe(false);
  });
});
