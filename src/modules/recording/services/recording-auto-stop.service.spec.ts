import { RecordingSessionService } from './recording-session.service.js';

/**
 * [FIX 2026-08-12, R9 — Lớp 1] stopAllActiveForMeeting(). File test RIÊNG.
 * Cô lập logic loop/try-catch của stopAllActiveForMeeting() bằng cách spy stopVideo()
 * (đã có test riêng đầy đủ ở recording-session.service.spec.ts /
 * recording-session-lock.service.spec.ts — không lặp lại ở đây).
 */
describe('RecordingSessionService.stopAllActiveForMeeting (R9)', () => {
  function makeService(sessionRows: Array<{ id: string }>) {
    const query = jest.fn().mockResolvedValue(sessionRows);
    const manager = { query };
    const dataSource = {
      manager,
      transaction: jest.fn((cb: (m: any) => unknown) => cb(manager)),
    };
    const configService = { get: jest.fn() };
    const processManager = {};
    const storageService = {};
    const service = new RecordingSessionService(
      dataSource as never,
      configService as never,
      processManager as never,
      storageService as never,
    );
    return { service, query };
  }

  afterEach(() => jest.restoreAllMocks());

  it('[A1] 1 session active → gọi stopVideo đúng 1 lần, trả scanned=1 stopped=1 failed=0', async () => {
    const { service, query } = makeService([{ id: 's1' }]);
    const stopSpy = jest
      .spyOn(service, 'stopVideo')
      .mockResolvedValue({ status: 'stopped' } as never);

    const r = await service.stopAllActiveForMeeting('m1', null);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('FROM recording_sessions');
    expect(sql).toContain("status IN ('starting','recording','paused')");
    expect(params).toEqual(['m1']);
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledWith('m1', 's1', null);
    expect(r).toEqual({ scanned: 1, stopped: 1, failed: 0 });
  });

  it('[A2] NHIỀU session active (video+audio) → TẤT CẢ đều được gọi stopVideo', async () => {
    const { service } = makeService([
      { id: 'sess-video' },
      { id: 'sess-audio' },
    ]);
    const stopSpy = jest
      .spyOn(service, 'stopVideo')
      .mockResolvedValue({ status: 'stopped' } as never);

    const r = await service.stopAllActiveForMeeting('m1', null);

    expect(stopSpy).toHaveBeenCalledTimes(2);
    expect(stopSpy).toHaveBeenNthCalledWith(1, 'm1', 'sess-video', null);
    expect(stopSpy).toHaveBeenNthCalledWith(2, 'm1', 'sess-audio', null);
    expect(r).toEqual({ scanned: 2, stopped: 2, failed: 0 });
  });

  it('[A3] 1 session lỗi → các session còn lại VẪN được dừng, method KHÔNG throw ra ngoài', async () => {
    const { service } = makeService([
      { id: 'bad' },
      { id: 'good-1' },
      { id: 'good-2' },
    ]);
    const stopSpy = jest
      .spyOn(service, 'stopVideo')
      .mockRejectedValueOnce(new Error('ffmpeg concat failed'))
      .mockResolvedValueOnce({ status: 'stopped' } as never)
      .mockResolvedValueOnce({ status: 'stopped' } as never);

    const r = await expect(
      service.stopAllActiveForMeeting('m1', null),
    ).resolves.toEqual({ scanned: 3, stopped: 2, failed: 1 });

    expect(stopSpy).toHaveBeenCalledTimes(3);
    void r;
  });

  it('[A4] KHÔNG có session nào active → KHÔNG gọi stopVideo, trả scanned=0 stopped=0 failed=0', async () => {
    const { service, query } = makeService([]);
    const stopSpy = jest.spyOn(service, 'stopVideo');

    const r = await service.stopAllActiveForMeeting('m1', null);

    expect(query).toHaveBeenCalledTimes(1);
    expect(stopSpy).not.toHaveBeenCalled();
    expect(r).toEqual({ scanned: 0, stopped: 0, failed: 0 });
  });

  it('[A5] userId=null được truyền NGUYÊN VẸN cho stopVideo() ở mọi vòng lặp (R3: KHÔNG bị assertHostOrAdmin chặn)', async () => {
    const { service } = makeService([{ id: 's1' }, { id: 's2' }]);
    const stopSpy = jest
      .spyOn(service, 'stopVideo')
      .mockResolvedValue({ status: 'stopped' } as never);

    await service.stopAllActiveForMeeting('m1', null);

    for (const call of stopSpy.mock.calls) {
      expect(call[2]).toBeNull();
    }
  });
});
