/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { RecordingSessionService } from './recording-session.service.js';
import { RecordingProcessManager } from './recording-process-manager.js';
import { StorageService } from '../../storage/storage.service.js';
import * as fs from 'fs';

jest.mock('fs');
const fsMock = fs as jest.Mocked<typeof fs>;

/**
 * [FIX 2026-08-11, Phần 1] Advisory lock (pg_advisory_xact_lock) cho startVideo (khoá
 * meetingId) và pauseVideo/resumeVideo/stopVideo (khoá sessionId) — file test RIÊNG,
 * tập trung vào tính ĐÚNG ĐẮN của khoá dưới concurrency thật (2 lời gọi song song), KHÔNG
 * lặp lại các test happy-path/validation đã có ở recording-session.service.spec.ts /
 * recording-pause-resume.service.spec.ts.
 *
 * Kỹ thuật mock: mirror ĐÚNG "RACE FIX" describe của vehicle-resolve.service.spec.ts —
 * `dataSource.transaction()` mock dùng 1 `lockChain` (Promise mutex) để đảm bảo callback
 * của lời gọi SAU chỉ bắt đầu chạy SAU KHI callback của lời gọi TRƯỚC đã settle (resolve/
 * reject) — đúng ngữ nghĩa pg_advisory_xact_lock thật: transaction sau đợi transaction
 * trước COMMIT/ROLLBACK (giải phóng lock) rồi mới được cấp lock.
 */
describe('RecordingSessionService — advisory lock concurrency (FIX 2026-08-11)', () => {
  const baseDevice = () => ({
    id: 'cam-1',
    device_type: 'ip_camera',
    metadata_json: {
      rtsp_config: {
        rtsp_protocol: 'rtsp',
        rtsp_host: '10.0.0.5',
        rtsp_port: 554,
        rtsp_path: '/live',
      },
    },
  });

  beforeEach(() => {
    process.env.RTSP_CRED_KEY = 'test_rtsp_cred_key_0123456789_abcdefghij';
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 1024 } as any);
    fsMock.mkdirSync.mockReturnValue(undefined);
  });
  afterEach(() => jest.clearAllMocks());

  // ─── startVideo(): khoá theo meetingId ───────────────────────────────────
  it('startVideo(): 2 request đồng thời cùng meetingId → CHỈ 1 thành công, request kia 409 RECORDING_ALREADY_ACTIVE, DB chỉ có ĐÚNG 1 row', async () => {
    let lockChain: Promise<unknown> = Promise.resolve();
    const sessions: any[] = []; // bảng recording_sessions giả lập, state DÙNG CHUNG giữa 2 lời gọi song song

    const manager = {
      query: jest.fn((sql: string) => {
        if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([{}]);
        if (sql.includes('FROM meetings'))
          return Promise.resolve([{ id: 'm1' }]);
        // [FIX 2026-08-11, R10] assertHostOrAdmin host check — 'u1' luôn là host, bypass
        // ngay (không cần role check) để KHÔNG đổi ý nghĩa test lock/race này.
        if (sql.includes('FROM meeting_participants'))
          return Promise.resolve([{ id: 'u1' }]);
        if (sql.includes('FROM iot_devices'))
          return Promise.resolve([baseDevice()]);
        if (sql.includes('FROM recording_configs')) return Promise.resolve([]);
        if (sql.includes('FROM recording_sessions')) {
          // Bước 4 (active check) — ĐỌC state chung `sessions`, KHÔNG cache riêng.
          return Promise.resolve(
            sessions.length > 0 ? [{ id: sessions[0].id }] : [],
          );
        }
        return Promise.resolve([]);
      }),
      create: jest.fn((_e: unknown, obj: any) => obj),
      save: jest.fn(async (_e: unknown, obj: any) => {
        sessions.push(obj);
        return obj;
      }),
    };

    const dataSourceMock = {
      manager,
      transaction: jest.fn((cb: (m: any) => Promise<unknown>) => {
        const run = lockChain.then(() => cb(manager));
        lockChain = run.catch(() => undefined);
        return run;
      }),
    };
    const processManager = {
      start: jest.fn(),
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({ exitCode: null }),
      stop: jest.fn().mockResolvedValue('exited'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingSessionService,
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
        { provide: RecordingProcessManager, useValue: processManager },
        { provide: StorageService, useValue: { saveFile: jest.fn() } },
      ],
    }).compile();
    const service = module.get(RecordingSessionService);

    const results = await Promise.allSettled([
      service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1'),
      service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(rejected[0].reason).toMatchObject({
      response: { code: 'RECORDING_ALREADY_ACTIVE' },
    });
    expect(sessions).toHaveLength(1); // DB chỉ có ĐÚNG 1 row, KHÔNG phải 2
    expect(dataSourceMock.transaction).toHaveBeenCalledTimes(2);
  });

  // ─── pauseVideo(): khoá theo sessionId ────────────────────────────────────
  it('pauseVideo(): 2 request đồng thời cùng sessionId → CHỈ 1 thành công, request kia 409 RECORDING_NOT_RECORDING (đã bị request thắng chuyển sang PAUSED)', async () => {
    let lockChain: Promise<unknown> = Promise.resolve();
    const session = {
      id: 's1',
      meeting_id: 'm1',
      status: 'recording',
      storage_path: '/rec/s1.mp4',
      metadata_json: null as Record<string, unknown> | null,
    };

    const manager = {
      query: jest.fn((sql: string, params: any[]) => {
        if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([{}]);
        if (sql.includes('SELECT') && sql.includes('recording_sessions')) {
          // FRESH read mỗi lần — trả state HIỆN TẠI của `session` (dùng chung).
          return Promise.resolve([{ ...session }]);
        }
        if (sql.includes('UPDATE recording_sessions')) {
          session.status = params[0] as string;
          session.metadata_json = JSON.parse(params[1] as string) as Record<
            string,
            unknown
          >;
          return Promise.resolve(undefined);
        }
        return Promise.resolve([]);
      }),
    };
    const dataSourceMock = {
      manager,
      transaction: jest.fn((cb: (m: any) => Promise<unknown>) => {
        const run = lockChain.then(() => cb(manager));
        lockChain = run.catch(() => undefined);
        return run;
      }),
    };
    const processManager = {
      markStopping: jest.fn(),
      stop: jest.fn().mockResolvedValue('exited'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingSessionService,
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
        { provide: RecordingProcessManager, useValue: processManager },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    const service = module.get(RecordingSessionService);

    const results = await Promise.allSettled([
      service.pauseVideo('m1', 's1'),
      service.pauseVideo('m1', 's1'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(rejected[0].reason).toMatchObject({
      response: { code: 'RECORDING_NOT_RECORDING' },
    });
    expect(session.status).toBe('paused'); // đúng 1 lần chuyển trạng thái, không bị ghi 2 lần
  });

  // ─── R8 CRUX: race Stop/Pause — KHÔNG được mất segment ────────────────────
  it('R8 CRUX — stopVideo() gọi khi pauseVideo() ĐANG GIỮ LOCK (chưa commit) → stopVideo PHẢI CHỜ pauseVideo commit xong, rồi đọc metadata_json ĐÃ CÓ segment mới nhất (KHÔNG mất segment)', async () => {
    let lockChain: Promise<unknown> = Promise.resolve();
    // Session đã qua 1 lượt pause/resume trước đó (có sẵn 1 segment cũ), ĐANG recording
    // segment thứ 2 tại storage_path hiện tại. Lượt pause() SẮP xảy ra sẽ đóng segment thứ 2
    // này lại và đẩy nó vào `segments`.
    const session = {
      id: 's1',
      meeting_id: 'm1',
      status: 'recording',
      storage_path: '/rec/s1_seg1.mp4', // segment ĐANG ghi — pauseVideo() sẽ đóng + push cái này
      started_at: new Date(Date.now() - 120000).toISOString(),
      paused_duration_seconds: 0,
      metadata_json: { segments: ['/rec/s1_seg0.mp4'] } as Record<
        string,
        unknown
      >,
    };

    // Đánh dấu THỨ TỰ thực thi thật (không suy luận qua timing) — proof trực tiếp cho
    // "stopVideo đợi pauseVideo commit xong".
    const executionOrder: string[] = [];

    const manager = {
      query: jest.fn((sql: string, params: any[]) => {
        if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([{}]);
        // [FIX 2026-08-11, R10] assertHostOrAdmin host check (stopVideo gọi với userId='u1')
        // — 'u1' luôn là host, bypass ngay để KHÔNG đổi ý nghĩa test R8 CRUX này.
        if (sql.includes('FROM meeting_participants'))
          return Promise.resolve([{ id: 'u1' }]);
        if (sql.includes('SELECT') && sql.includes('recording_sessions')) {
          return Promise.resolve([{ ...session }]);
        }
        if (sql.includes('UPDATE recording_sessions') && params.length === 3) {
          // pauseVideo(): UPDATE ... SET status=$1, metadata_json=$2 WHERE id=$3
          session.status = params[0] as string;
          session.metadata_json = JSON.parse(params[1] as string) as Record<
            string,
            unknown
          >;
          return Promise.resolve(undefined);
        }
        // stopVideo() nhánh "empty file" (7 params) — không quan trọng nội dung, chỉ cần
        // không throw để flow chạy hết.
        return Promise.resolve(undefined);
      }),
    };
    const dataSourceMock = {
      manager,
      transaction: jest.fn((cb: (m: any) => Promise<unknown>) => {
        const run = lockChain.then(() => cb(manager));
        lockChain = run.catch(() => undefined);
        return run;
      }),
    };
    const processManager = {
      markStopping: jest.fn(() => executionOrder.push('pause:markStopping')),
      stop: jest.fn(async () => {
        executionOrder.push('processManager.stop');
        return 'exited';
      }),
      has: jest.fn().mockReturnValue(false), // đã dừng bởi pause, stopVideo thấy KHÔNG còn handle
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingSessionService,
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
        { provide: RecordingProcessManager, useValue: processManager },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    const service: any = module.get(RecordingSessionService);

    // Spy resolveStopFile — bắt ĐÚNG snapshot `session` mà stopVideo() truyền vào, đây là
    // bằng chứng TRỰC TIẾP cho "đọc đúng metadata_json đã có segment mới nhất" (resolveStopFile
    // là nơi DUY NHẤT xây danh sách segment để concat — snapshot đủ segment ⇒ concat sẽ đủ,
    // KHÔNG cần lặp lại cơ chế ffmpeg concat đã test riêng ở recording-stop-concat).
    let capturedSessionAtStop: any = null;
    jest
      .spyOn(service, 'resolveStopFile')
      .mockImplementation(async (_sid: string, s: any) => {
        capturedSessionAtStop = s;
        executionOrder.push('stop:resolveStopFile');
        return { storagePath: null, cleanup: () => {} }; // ép nhánh "empty file" — gọn, không cần fs/ffmpeg thật
      });

    // pauseVideo() gọi TRƯỚC (giành lock trước) — mirror "đang giữ lock chưa commit".
    const pausePromise = service.pauseVideo('m1', 's1').then((r: unknown) => {
      executionOrder.push('pause:done');
      return r;
    });
    // stopVideo() gọi NGAY SAU, gần như đồng thời — do lockChain, callback của nó
    // KHÔNG được thực thi cho tới khi callback của pauseVideo() ở trên settle (COMMIT).
    const stopPromise = service
      .stopVideo('m1', 's1', 'u1')
      .then((r: unknown) => {
        executionOrder.push('stop:done');
        return r;
      });

    const [pauseResult, stopResult] = await Promise.all([
      pausePromise,
      stopPromise,
    ]);

    // 1. Thứ tự thực thi THẬT: toàn bộ pauseVideo() (bao gồm UPDATE commit) chạy XONG
    //    TRƯỚC KHI stopVideo() bắt đầu đọc (resolveStopFile).
    expect(executionOrder.indexOf('pause:done')).toBeLessThan(
      executionOrder.indexOf('stop:resolveStopFile'),
    );

    // 2. pauseVideo() thành công, đúng như luồng bình thường.
    expect(pauseResult.status).toBe('paused');

    // 3. CRUX: snapshot mà stopVideo() dùng để build file concat PHẢI CÓ CẢ 2 segment —
    //    segment cũ (đã có từ trước) VÀ segment mới (do pauseVideo() vừa đóng+push).
    expect(capturedSessionAtStop).not.toBeNull();
    const segmentsSeenByStop = capturedSessionAtStop.metadata_json
      .segments as string[];
    expect(segmentsSeenByStop).toContain('/rec/s1_seg0.mp4'); // segment cũ
    expect(segmentsSeenByStop).toContain('/rec/s1_seg1.mp4'); // segment MỚI — đây là cái dễ bị mất nếu KHÔNG có lock
    expect(segmentsSeenByStop).toHaveLength(2);

    // 4. stopVideo() cũng thành công (status='stopped', dù captured=false do storagePath=null).
    expect(stopResult.status).toBe('stopped');
  });

  // ─── Namespace khoá KHÁC NHAU — start (meetingId) vs pause/resume/stop (sessionId) ──
  it('lock namespace: start (hashtext("recording_start_"||meetingId)) và pause/resume/stop (hashtext("recording_session_"||sessionId)) KHÁC PREFIX — không tự deadlock nếu trùng giá trị chuỗi', async () => {
    const capturedLockCalls: Array<{ sql: string; params: any[] }> = [];
    const manager = {
      query: jest.fn((sql: string, params: any[]) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          capturedLockCalls.push({ sql, params });
          return Promise.resolve([{}]);
        }
        if (sql.includes('FROM meetings'))
          return Promise.resolve([{ id: 'X' }]);
        // [FIX 2026-08-11, R10] assertHostOrAdmin host check — PHẢI đứng TRƯỚC nhánh
        // "WHERE meeting_id" bên dưới vì câu SQL host check cũng chứa chuỗi con đó
        // ('...meeting_participants WHERE meeting_id = $1...') — nếu để sau sẽ bị nhánh đó
        // "nuốt" nhầm và trả [] → assertHostOrAdmin tưởng KHÔNG phải host → rơi tiếp xuống
        // role check (cũng [] mặc định) → 403 sai, phá hỏng ý nghĩa test lock-namespace này.
        if (sql.includes('FROM meeting_participants'))
          return Promise.resolve([{ id: 'u1' }]);
        if (sql.includes('FROM iot_devices'))
          return Promise.resolve([baseDevice()]);
        if (sql.includes('FROM recording_configs')) return Promise.resolve([]);
        // startVideo() active-check: WHERE meeting_id = $1 ... → KHÔNG có session active
        // (để startVideo đi tới cuối thành công, không rơi vào nhánh 409 không liên quan
        // gì tới mục đích test này).
        if (sql.includes('WHERE meeting_id')) return Promise.resolve([]);
        // pauseVideo() fresh-read: WHERE id = $1 → trả đúng session đang recording.
        if (sql.includes('SELECT') && sql.includes('recording_sessions'))
          return Promise.resolve([
            {
              id: 'X',
              meeting_id: 'm-other',
              status: 'recording',
              storage_path: '/rec/x.mp4',
              metadata_json: null,
            },
          ]);
        return Promise.resolve([]);
      }),
      create: jest.fn((_e: unknown, obj: any) => obj),
      save: jest.fn(async (_e: unknown, obj: any) => obj),
    };
    const dataSourceMock = {
      manager,
      transaction: jest.fn((cb: (m: any) => Promise<unknown>) => cb(manager)),
    };
    const processManager = {
      start: jest.fn(),
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({ exitCode: null }),
      stop: jest.fn().mockResolvedValue('exited'),
      markStopping: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingSessionService,
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
        { provide: RecordingProcessManager, useValue: processManager },
        { provide: StorageService, useValue: { saveFile: jest.fn() } },
      ],
    }).compile();
    const service = module.get(RecordingSessionService);

    // Chuỗi 'X' dùng LÀM CẢ meetingId (start) LẪN sessionId (pause) — cùng 1 giá trị chuỗi
    // nhưng phải sinh ra 2 lock key KHÁC NHAU nhờ prefix khác nhau.
    await service.startVideo('X', { cameraDeviceId: 'cam-1' }, 'u1');
    await service.pauseVideo('m-other', 'X');

    expect(capturedLockCalls).toHaveLength(2);
    expect(capturedLockCalls[0].sql).toContain('recording_start_');
    expect(capturedLockCalls[0].params).toEqual(['X']);
    expect(capturedLockCalls[1].sql).toContain('recording_session_');
    expect(capturedLockCalls[1].params).toEqual(['X']);
    // 2 câu lock SQL literal khác nhau ⇒ hashtext(...) sinh 2 key khác nhau cho Postgres —
    // không có cách nào 2 lời gọi này tự khoá chéo nhau dù cùng giá trị chuỗi 'X'.
    expect(capturedLockCalls[0].sql).not.toEqual(capturedLockCalls[1].sql);
  });
});
