import { InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RecordingSessionService } from './recording-session.service.js';

/**
 * UC-114/115 — stopVideo concat branch. File test RIÊNG. Dùng FILE TẠM THẬT
 * (không spy fs — ESM không cho redefine); spy runFfmpegConcat + finalizeFileToStopped.
 * BR-06: 0-pause (segments rỗng) chạy Y HỆT (finalize(storage_path cũ), KHÔNG concat).
 */
describe('RecordingSessionService stopVideo concat (UC-114/115)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  function writeFile(name: string, size: number): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, Buffer.alloc(size));
    return p;
  }

  function makeService() {
    const query = jest.fn().mockResolvedValue([]);
    const dataSource = { manager: { query } };
    const configService = { get: jest.fn(() => tmpDir) };
    const processManager = {
      has: jest.fn().mockReturnValue(true),
      stop: jest.fn().mockResolvedValue('exited'),
    };
    const storageService = {};
    const service = new RecordingSessionService(
      dataSource as never,
      configService as never,
      processManager as never,
      storageService as never,
    );
    const finalizeSpy = jest
      .spyOn(service as never, 'finalizeFileToStopped')
      .mockResolvedValue({
        stoppedAt: new Date(),
        durationSeconds: 10,
        fileSizeBytes: '100',
        mediaFileId: 'mf1',
      } as never);
    // concat OK: tạo file out thật (return 0). Ghi đè ở S4 để trả lỗi.
    const concatSpy = jest
      .spyOn(service as never, 'runFfmpegConcat')
      .mockImplementation(((_list: string, out: string) => {
        fs.writeFileSync(out, Buffer.alloc(100));
        return Promise.resolve(0);
      }) as never);
    return { service, query, processManager, finalizeSpy, concatSpy };
  }

  function sessionRow(over: Record<string, unknown> = {}) {
    return {
      id: 's1',
      meeting_id: 'm1',
      status: 'recording',
      storage_path: null,
      started_at: new Date(Date.now() - 60000).toISOString(),
      paused_duration_seconds: 0,
      metadata_json: null,
      ...over,
    };
  }

  it('[S1] (BR-06) 0-pause (segments rỗng) → finalize(storage_path cũ), KHÔNG concat', async () => {
    const { service, query, finalizeSpy, concatSpy } = makeService();
    const main = writeFile('s1.mp4', 100);
    query.mockResolvedValueOnce([sessionRow({ storage_path: main })]);

    await service.stopVideo('m1', 's1', 'u1');

    expect(concatSpy).not.toHaveBeenCalled();
    const arg = finalizeSpy.mock.calls[0][0] as { storagePath: string };
    expect(arg.storagePath).toBe(main); // luồng cũ y hệt
  });

  it('[S2] 1 segment → finalize(segment), KHÔNG concat', async () => {
    const { service, query, finalizeSpy, concatSpy } = makeService();
    const seg0 = writeFile('s1.mp4', 100);
    query.mockResolvedValueOnce([
      sessionRow({ storage_path: seg0, metadata_json: { segments: [seg0] } }),
    ]);

    await service.stopVideo('m1', 's1', 'u1');

    expect(concatSpy).not.toHaveBeenCalled();
    const arg = finalizeSpy.mock.calls[0][0] as { storagePath: string };
    expect(arg.storagePath).toBe(seg0);
  });

  it('[S3] >1 segment → concat ra {sessionId}_final.mp4 → finalize', async () => {
    const { service, query, finalizeSpy, concatSpy } = makeService();
    const seg0 = writeFile('s1.mp4', 100);
    const seg1 = writeFile('s1_seg1.mp4', 100);
    query.mockResolvedValueOnce([
      sessionRow({
        storage_path: seg1,
        metadata_json: { segments: [seg0, seg1] },
      }),
    ]);

    await service.stopVideo('m1', 's1', 'u1');

    expect(concatSpy).toHaveBeenCalledTimes(1);
    const arg = finalizeSpy.mock.calls[0][0] as { storagePath: string };
    expect(arg.storagePath).toContain('s1_final.mp4');
    // segment gốc đã bị cleanup sau finalize
    expect(fs.existsSync(seg0)).toBe(false);
    expect(fs.existsSync(seg1)).toBe(false);
  });

  it('[S4] concat lỗi (exit≠0) → 500, KHÔNG finalize, KHÔNG xóa segment', async () => {
    const { service, query, finalizeSpy, concatSpy } = makeService();
    concatSpy.mockResolvedValue(1 as never); // lỗi, không tạo out
    const seg0 = writeFile('s1.mp4', 100);
    const seg1 = writeFile('s1_seg1.mp4', 100);
    query.mockResolvedValueOnce([
      sessionRow({
        storage_path: seg1,
        metadata_json: { segments: [seg0, seg1] },
      }),
    ]);

    await expect(service.stopVideo('m1', 's1', 'u1')).rejects.toThrow(
      InternalServerErrorException,
    );
    expect(finalizeSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(seg0)).toBe(true); // GIỮ segment
    expect(fs.existsSync(seg1)).toBe(true);
  });

  it('[S5] lọc 0-byte segment → còn 1 valid → không concat', async () => {
    const { service, query, concatSpy, finalizeSpy } = makeService();
    const seg0 = writeFile('s1.mp4', 100);
    const seg1 = writeFile('s1_seg1.mp4', 0); // 0-byte → bị lọc
    query.mockResolvedValueOnce([
      sessionRow({
        storage_path: seg1,
        metadata_json: { segments: [seg0, seg1] },
      }),
    ]);

    await service.stopVideo('m1', 's1', 'u1');
    expect(concatSpy).not.toHaveBeenCalled();
    const arg = finalizeSpy.mock.calls[0][0] as { storagePath: string };
    expect(arg.storagePath).toBe(seg0);
  });

  it('[S6] pause→stop (status=paused) → KHÔNG stop process; concat segments đã có', async () => {
    const { service, query, processManager, concatSpy } = makeService();
    const seg0 = writeFile('s1.mp4', 100);
    const seg1 = writeFile('s1_seg1.mp4', 100);
    query.mockResolvedValueOnce([
      sessionRow({
        status: 'paused',
        storage_path: seg1,
        metadata_json: { segments: [seg0, seg1] },
      }),
    ]);

    await service.stopVideo('m1', 's1', 'u1');
    expect(processManager.stop).not.toHaveBeenCalled(); // paused: không stop lại
    expect(concatSpy).toHaveBeenCalledTimes(1);
  });
});
