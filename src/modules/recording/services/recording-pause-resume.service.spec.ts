import {
  ConflictException,
  NotFoundException,
  BadGatewayException,
  ForbiddenException,
} from '@nestjs/common';
import * as os from 'os';
import { RecordingSessionService } from './recording-session.service.js';

/**
 * UC-114/115 — pauseVideo/resumeVideo. File test RIÊNG.
 * BR-05: pause = markStopping+stop (đóng file); resume = start segment mới.
 * baseDir = os.tmpdir() (mkdirSync recursive = no-op thật, không cần spy fs).
 */
describe('RecordingSessionService pause/resume (UC-114/115)', () => {
  function makeService() {
    const query = jest.fn();
    const manager = { query };
    // [FIX 2026-08-11, R3/R4/R8] pauseVideo()/resumeVideo() giờ bọc thân hàm trong
    // dataSource.transaction() (khoá theo sessionId) — mock gọi callback với CHÍNH
    // `manager` ở trên để mọi test hiện có (mock query trực tiếp) chạy đúng KHÔNG đổi.
    const dataSource = {
      manager,
      transaction: jest.fn((cb: (m: any) => unknown) => cb(manager)),
    };
    const configService = { get: jest.fn(() => os.tmpdir()) };
    const processManager = {
      markStopping: jest.fn(),
      stop: jest.fn().mockResolvedValue('exited'),
      has: jest.fn().mockReturnValue(true),
      start: jest.fn(),
    };
    const storageService = {};
    const service = new RecordingSessionService(
      dataSource as never,
      configService as never,
      processManager as never,
      storageService as never,
    );
    return { service, query, processManager };
  }

  afterEach(() => jest.restoreAllMocks());

  // [FIX 2026-08-11] Mọi transaction giờ mở đầu bằng 1 câu SELECT pg_advisory_xact_lock —
  // helper trả giá trị placeholder (nội dung không được app code dùng tới) để prepend vào
  // MỌI chuỗi mockResolvedValueOnce bên dưới, giữ đúng thứ tự các call tiếp theo.
  const lockOk = () => [{}];

  // ---------- PAUSE (UC-114) ----------
  it('[P1] pause OK → markStopping+stop, status=paused, segments push, paused_at set', async () => {
    const { service, query, processManager } = makeService();
    query
      .mockResolvedValueOnce(lockOk()) // pg_advisory_xact_lock
      .mockResolvedValueOnce([
        {
          id: 's1',
          meeting_id: 'm1',
          status: 'recording',
          storage_path: '/rec/s1.mp4',
          metadata_json: null,
        },
      ])
      .mockResolvedValueOnce([]);

    const res = await service.pauseVideo('m1', 's1');

    expect(processManager.markStopping).toHaveBeenCalledWith('s1');
    expect(processManager.stop).toHaveBeenCalledWith('s1');
    expect(res.status).toBe('paused');
    expect(res.pauseCount).toBe(1);

    const updateArgs = (query.mock.calls[2] as unknown[][])[1];
    expect(updateArgs[0]).toBe('paused');
    const meta = JSON.parse(updateArgs[1] as string) as {
      segments: string[];
      paused_at: string;
      pause_count: number;
    };
    expect(meta.segments).toContain('/rec/s1.mp4');
    expect(typeof meta.paused_at).toBe('string');
    expect(meta.pause_count).toBe(1);
  });

  it('[P2] pause khi ≠recording → 409 RECORDING_NOT_RECORDING', async () => {
    const { service, query } = makeService();
    query.mockResolvedValueOnce(lockOk()).mockResolvedValueOnce([
      {
        id: 's1',
        meeting_id: 'm1',
        status: 'paused',
        storage_path: '/rec/s1.mp4',
        metadata_json: null,
      },
    ]);
    await expect(service.pauseVideo('m1', 's1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('[P3] pause session không tồn tại/khác meeting → 404', async () => {
    const { service, query } = makeService();
    query.mockResolvedValueOnce(lockOk()).mockResolvedValueOnce([]);
    await expect(service.pauseVideo('m1', 's1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('[P9] (BR-05) markStopping gọi TRƯỚC stop', async () => {
    const { service, query, processManager } = makeService();
    query
      .mockResolvedValueOnce(lockOk())
      .mockResolvedValueOnce([
        {
          id: 's1',
          meeting_id: 'm1',
          status: 'recording',
          storage_path: '/rec/s1.mp4',
          metadata_json: null,
        },
      ])
      .mockResolvedValueOnce([]);
    await service.pauseVideo('m1', 's1');
    const markOrder = processManager.markStopping.mock.invocationCallOrder[0];
    const stopOrder = processManager.stop.mock.invocationCallOrder[0];
    expect(markOrder).toBeLessThan(stopOrder);
  });

  // ---------- PAUSE — R10 ownership ----------
  it('[P10] host của meeting → pause OK (không phải admin)', async () => {
    const { service, query } = makeService();
    query
      .mockResolvedValueOnce([{ id: 'u1' }]) // assertHostOrAdmin: host check
      .mockResolvedValueOnce(lockOk())
      .mockResolvedValueOnce([
        {
          id: 's1',
          meeting_id: 'm1',
          status: 'recording',
          storage_path: '/rec/s1.mp4',
          metadata_json: null,
        },
      ])
      .mockResolvedValueOnce([]);
    const res = await service.pauseVideo('m1', 's1', 'u1');
    expect(res.status).toBe('paused');
  });

  it('[P11] không phải host và không phải admin → 403 PERMISSION_DENIED', async () => {
    const { service, query } = makeService();
    query
      .mockResolvedValueOnce([]) // host check: rỗng
      .mockResolvedValueOnce([{ role_code: 'EMPLOYEE' }]); // role check: không phải admin
    await expect(service.pauseVideo('m1', 's1', 'u2')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('[P12] SYSTEM_ADMIN không phải host → vẫn pause OK (bypass)', async () => {
    const { service, query } = makeService();
    query
      .mockResolvedValueOnce([]) // host check: rỗng
      .mockResolvedValueOnce([{ role_code: 'SYSTEM_ADMIN' }])
      .mockResolvedValueOnce(lockOk())
      .mockResolvedValueOnce([
        {
          id: 's1',
          meeting_id: 'm1',
          status: 'recording',
          storage_path: '/rec/s1.mp4',
          metadata_json: null,
        },
      ])
      .mockResolvedValueOnce([]);
    const res = await service.pauseVideo('m1', 's1', 'admin1');
    expect(res.status).toBe('paused');
  });

  // ---------- RESUME (UC-115) ----------
  function pausedSession(over: Record<string, unknown> = {}) {
    return {
      id: 's1',
      meeting_id: 'm1',
      status: 'paused',
      device_id: 'd1',
      paused_duration_seconds: 0,
      metadata_json: {
        segments: ['/rec/s1.mp4'],
        paused_at: new Date(Date.now() - 10000).toISOString(),
        pause_count: 1,
      },
      ...over,
    };
  }
  const deviceRow = [
    { metadata_json: { rtsp_config: { rtsp_host: 'h', rtsp_path: '/p' } } },
  ];

  it('[P4/P8] resume OK → start segment mới (_seg1), pausedDuration cộng, status=recording, paused_at xóa', async () => {
    const { service, query, processManager } = makeService();
    jest
      .spyOn(service as never, 'probeStart')
      .mockResolvedValue('capturing' as never);
    jest
      .spyOn(service as never, 'buildRtspUrl')
      .mockReturnValue('rtsp://fake' as never);
    query
      .mockResolvedValueOnce(lockOk()) // pg_advisory_xact_lock
      .mockResolvedValueOnce([pausedSession()]) // SELECT session
      .mockResolvedValueOnce(deviceRow) // SELECT device
      .mockResolvedValueOnce([]); // UPDATE

    const res = await service.resumeVideo('m1', 's1');

    expect(processManager.start).toHaveBeenCalled();
    const startArgs = processManager.start.mock.calls[0] as unknown[];
    expect(String(startArgs[2])).toContain('s1_seg1.mp4'); // segments.length=1 → _seg1
    expect(res.status).toBe('recording');
    expect(res.pausedDurationSeconds).toBeGreaterThanOrEqual(9); // ~10s pause

    const updateArgs = (query.mock.calls[3] as unknown[][])[1];
    expect(updateArgs[0]).toBe('recording');
    const meta = JSON.parse(updateArgs[3] as string) as {
      segments: string[];
      paused_at?: string;
    };
    expect(meta.segments).toHaveLength(2); // cũ + segMới
    expect(meta.paused_at).toBeUndefined(); // đã xóa
  });

  it('[P5] resume khi ≠paused → 409 RECORDING_NOT_PAUSED', async () => {
    const { service, query } = makeService();
    query
      .mockResolvedValueOnce(lockOk())
      .mockResolvedValueOnce([pausedSession({ status: 'recording' })]);
    await expect(service.resumeVideo('m1', 's1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('[P6] resume no-data → GIỮ paused + 502, KHÔNG cộng pausedDuration (không UPDATE recording)', async () => {
    const { service, query, processManager } = makeService();
    jest
      .spyOn(service as never, 'probeStart')
      .mockResolvedValue('no_data' as never);
    jest
      .spyOn(service as never, 'buildRtspUrl')
      .mockReturnValue('rtsp://fake' as never);
    query
      .mockResolvedValueOnce(lockOk()) // pg_advisory_xact_lock
      .mockResolvedValueOnce([pausedSession()]) // SELECT session
      .mockResolvedValueOnce(deviceRow); // SELECT device

    await expect(service.resumeVideo('m1', 's1')).rejects.toThrow(
      BadGatewayException,
    );
    // Đã stop process segment mới hỏng
    expect(processManager.stop).toHaveBeenCalledWith('s1');
    // KHÔNG có query UPDATE thứ 4 (status vẫn paused trong DB) — lock + SELECT session +
    // SELECT device = 3 call, KHÔNG có UPDATE.
    expect(query).toHaveBeenCalledTimes(3);
  });

  // ---------- RESUME — R10 ownership ----------
  it('[P13] host của meeting → resume OK (không phải admin)', async () => {
    const { service, query } = makeService();
    jest
      .spyOn(service as never, 'probeStart')
      .mockResolvedValue('capturing' as never);
    jest
      .spyOn(service as never, 'buildRtspUrl')
      .mockReturnValue('rtsp://fake' as never);
    query
      .mockResolvedValueOnce([{ id: 'u1' }]) // assertHostOrAdmin: host check
      .mockResolvedValueOnce(lockOk())
      .mockResolvedValueOnce([pausedSession()])
      .mockResolvedValueOnce(deviceRow)
      .mockResolvedValueOnce([]);
    const res = await service.resumeVideo('m1', 's1', 'u1');
    expect(res.status).toBe('recording');
  });

  it('[P14] không phải host và không phải admin → 403 PERMISSION_DENIED', async () => {
    const { service, query } = makeService();
    query
      .mockResolvedValueOnce([]) // host check: rỗng
      .mockResolvedValueOnce([{ role_code: 'EMPLOYEE' }]); // role check: không phải admin
    await expect(service.resumeVideo('m1', 's1', 'u2')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('[P15] SYSTEM_ADMIN không phải host → vẫn resume OK (bypass)', async () => {
    const { service, query } = makeService();
    jest
      .spyOn(service as never, 'probeStart')
      .mockResolvedValue('capturing' as never);
    jest
      .spyOn(service as never, 'buildRtspUrl')
      .mockReturnValue('rtsp://fake' as never);
    query
      .mockResolvedValueOnce([]) // host check: rỗng
      .mockResolvedValueOnce([{ role_code: 'SYSTEM_ADMIN' }])
      .mockResolvedValueOnce(lockOk())
      .mockResolvedValueOnce([pausedSession()])
      .mockResolvedValueOnce(deviceRow)
      .mockResolvedValueOnce([]);
    const res = await service.resumeVideo('m1', 's1', 'admin1');
    expect(res.status).toBe('recording');
  });
});
