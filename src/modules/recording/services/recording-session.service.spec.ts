/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { RecordingSessionService } from './recording-session.service.js';
import { RecordingProcessManager } from './recording-process-manager.js';
import { encryptSecret } from '../../../common/utils/secret-crypto.util.js';
import { redactUrl } from '../utils/ffmpeg.util.js';
import { EventEmitter } from 'events';
import * as fs from 'fs';

jest.mock('fs');
const fsMock = fs as jest.Mocked<typeof fs>;

describe('RecordingSessionService (REC-002)', () => {
  let service: RecordingSessionService;
  let dataSourceMock: any;
  let managerMock: any;
  let savedSession: any;

  const baseDevice = (over: any = {}) => ({
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
    ...over,
  });

  // query() router theo SQL
  const makeQuery =
    (opts: { meeting?: any[]; device?: any[]; active?: any[]; cfg?: any[] }) =>
    (sql: string) => {
      if (sql.includes('FROM meetings'))
        return Promise.resolve(opts.meeting ?? [{ id: 'm1' }]);
      if (sql.includes('FROM iot_devices'))
        return Promise.resolve(opts.device ?? [baseDevice()]);
      if (sql.includes('FROM recording_sessions'))
        return Promise.resolve(opts.active ?? []);
      if (sql.includes('FROM recording_configs'))
        return Promise.resolve(opts.cfg ?? []);
      return Promise.resolve([]);
    };

  beforeEach(async () => {
    process.env.RTSP_CRED_KEY = 'test_rtsp_cred_key_0123456789_abcdefghij';
    savedSession = null;
    dataSourceMock = {
      manager: {
        query: jest.fn(),
        create: jest.fn((_e: unknown, obj: any) => obj),
        save: jest.fn(async (_e: unknown, obj: any) => {
          savedSession = obj;
          return obj;
        }),
      },
    };
    managerMock = {
      start: jest.fn(),
      waitForGrace: jest.fn().mockResolvedValue('alive'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingSessionService,
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
        { provide: RecordingProcessManager, useValue: managerMock },
      ],
    }).compile();
    service = module.get(RecordingSessionService);
  });

  it('happy: 201 → session recording, spawn gọi', async () => {
    dataSourceMock.manager.query.mockImplementation(makeQuery({}));

    const r = await service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1');

    expect(r.status).toBe('recording');
    expect(r.sessionType).toBe('video');
    expect(r.cameraDeviceId).toBe('cam-1');
    expect(managerMock.start).toHaveBeenCalledTimes(1);
    expect(savedSession.status).toBe('recording');
    expect(savedSession.storageProvider).toBe('local');
    expect(savedSession.startedBy).toBe('u1');
  });

  it('404: meeting không tồn tại', async () => {
    dataSourceMock.manager.query.mockImplementation(makeQuery({ meeting: [] }));
    await expect(
      service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('400: device không phải ip_camera', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ device: [baseDevice({ device_type: 'microphone' })] }),
    );
    await expect(
      service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('400: thiếu rtsp_config', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ device: [baseDevice({ metadata_json: {} })] }),
    );
    await expect(
      service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('409: đã có session active', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ active: [{ id: 'sess-x' }] }),
    );
    await expect(
      service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1'),
    ).rejects.toThrow(ConflictException);
  });

  it('ffmpeg chết trong grace → 500 RECORDING_START_FAILED', async () => {
    dataSourceMock.manager.query.mockImplementation(makeQuery({}));
    managerMock.waitForGrace.mockResolvedValue('dead');
    await expect(
      service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1'),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('SEC: URL/password KHÔNG xuất hiện trong session lưu', async () => {
    // device có username + password mã hóa
    const enc = encryptSecret('super-secret-pass');
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({
        device: [
          baseDevice({
            metadata_json: {
              rtsp_config: {
                rtsp_protocol: 'rtsp',
                rtsp_host: '10.0.0.5',
                rtsp_port: 554,
                rtsp_path: '/live',
                rtsp_username: 'admin',
                rtsp_password_encrypted: enc,
              },
            },
          }),
        ],
      }),
    );

    await service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1');

    const dump = JSON.stringify(savedSession);
    expect(dump).not.toContain('super-secret-pass');
    expect(dump).not.toContain('admin:'); // không có user:pass trong record
    // url được truyền cho manager.start (đối số) có cred, nhưng KHÔNG lưu vào DB
    const passedUrl = managerMock.start.mock.calls[0][1];
    expect(passedUrl).toContain('super-secret-pass'); // chỉ trong bộ nhớ truyền spawn
    expect(savedSession.storagePath).not.toContain('super-secret-pass');
  });

  it('SEC: password ký tự đặc biệt → URL encode + redactUrl che sạch', async () => {
    const raw = 'p@ss:w/rd#1';
    const encoded = 'p%40ss%3Aw%2Frd%231';
    const enc = encryptSecret(raw);
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({
        device: [
          baseDevice({
            metadata_json: {
              rtsp_config: {
                rtsp_protocol: 'rtsp',
                rtsp_host: '10.0.0.5',
                rtsp_port: 554,
                rtsp_path: '/live',
                rtsp_username: 'admin',
                rtsp_password_encrypted: enc,
              },
            },
          }),
        ],
      }),
    );

    await service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1');

    const passedUrl = managerMock.start.mock.calls[0][1] as string;
    // password truyền cho ffmpeg ở dạng ĐÃ encode, KHÔNG còn dạng thô
    expect(passedUrl).toContain(encoded);
    expect(passedUrl).not.toContain(raw);
    expect(passedUrl).not.toContain('p@ss:w/rd');
    // redactUrl che sạch — không còn mảnh password nào
    const redacted = redactUrl(passedUrl);
    expect(redacted).toContain('//***@');
    expect(redacted).not.toContain(encoded);
    expect(redacted).not.toContain('p%40ss');
    expect(redacted).not.toContain(raw);
  });
});

// ─── REC-003: stopVideo ───
describe('RecordingSessionService.stopVideo (REC-003)', () => {
  let service: RecordingSessionService;
  let dataSourceMock: any;
  let managerMock: any;
  let qr: any;

  const baseSession = (over: any = {}) => ({
    id: 'sess-1',
    meeting_id: 'm1',
    status: 'recording',
    storage_path: '/rec/sess-1.mp4',
    started_at: new Date(Date.now() - 60000).toISOString(),
    paused_duration_seconds: 0,
    metadata_json: null,
    ...over,
  });

  // manager.query router: SELECT recording_sessions → session; UPDATE → [].
  const selectReturns =
    (session: any[] | null) =>
    (sql: string): Promise<any[]> => {
      if (sql.includes('SELECT') && sql.includes('recording_sessions'))
        return Promise.resolve(session ?? []);
      return Promise.resolve([]);
    };

  const fakeReadStream = () => {
    const s = new EventEmitter();
    process.nextTick(() => s.emit('end'));
    return s as any;
  };

  beforeEach(async () => {
    qr = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    dataSourceMock = {
      manager: { query: jest.fn() },
      createQueryRunner: jest.fn(() => qr),
    };
    managerMock = {
      has: jest.fn().mockReturnValue(true),
      stop: jest.fn().mockResolvedValue('exited'),
    };

    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 1024 } as any);
    fsMock.createReadStream.mockImplementation(() => fakeReadStream());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingSessionService,
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
        { provide: RecordingProcessManager, useValue: managerMock },
      ],
    }).compile();
    service = module.get(RecordingSessionService);
  });

  afterEach(() => jest.clearAllMocks());

  it('happy: 200 stopped + INSERT media_files + UPDATE session', async () => {
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession()]),
    );
    qr.query
      .mockResolvedValueOnce([{ id: 'media-1' }]) // INSERT RETURNING id
      .mockResolvedValueOnce(undefined); // UPDATE session

    const r = await service.stopVideo('m1', 'sess-1', 'u1');

    expect(r.status).toBe('stopped');
    expect(r.mediaFileId).toBe('media-1');
    expect(r.fileSizeBytes).toBe('1024');
    expect(r.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(managerMock.stop).toHaveBeenCalledWith('sess-1');
    expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
    expect(qr.query).toHaveBeenCalledTimes(2);
    // INSERT đúng cột video/mp4/local
    const insertParams = qr.query.mock.calls[0][1];
    expect(insertParams).toEqual(
      expect.arrayContaining(['video', 'video/mp4', 'local']),
    );
  });

  it('404: session không tồn tại', async () => {
    dataSourceMock.manager.query.mockImplementation(selectReturns([]));
    await expect(service.stopVideo('m1', 'sess-1', 'u1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404: meeting_id không khớp', async () => {
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession({ meeting_id: 'other' })]),
    );
    await expect(service.stopVideo('m1', 'sess-1', 'u1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('409: session không active (đã stopped)', async () => {
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession({ status: 'stopped' })]),
    );
    await expect(service.stopVideo('m1', 'sess-1', 'u1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('orphan: manager.has=false → vẫn stopped + metadata orphan_stop', async () => {
    managerMock.has.mockReturnValue(false);
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession()]),
    );
    qr.query
      .mockResolvedValueOnce([{ id: 'media-1' }])
      .mockResolvedValueOnce(undefined);

    const r = await service.stopVideo('m1', 'sess-1', 'u1');

    expect(r.status).toBe('stopped');
    expect(managerMock.stop).not.toHaveBeenCalled();
    // UPDATE (call thứ 2) chứa metadata_json có orphan_stop
    const updateParams = qr.query.mock.calls[1][1];
    const metaJson = updateParams.find(
      (p: unknown) => typeof p === 'string' && p.includes('orphan_stop'),
    );
    expect(metaJson).toBeDefined();
  });

  it('empty file: size 0 → stopped, KHÔNG media_files, mediaFileId null', async () => {
    fsMock.existsSync.mockReturnValue(false);
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession()]),
    );

    const r = await service.stopVideo('m1', 'sess-1', 'u1');

    expect(r.status).toBe('stopped');
    expect(r.mediaFileId).toBeNull();
    expect(r.fileSizeBytes).toBe('0');
    expect(dataSourceMock.createQueryRunner).not.toHaveBeenCalled();
    // UPDATE empty-file đi qua manager.query với error_message='empty file'
    const calls = dataSourceMock.manager.query.mock.calls;
    const updateCall = calls.find((c: any[]) =>
      String(c[0]).includes('UPDATE recording_sessions'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toEqual(expect.arrayContaining(['empty file']));
  });

  it('rollback: INSERT lỗi → 500 RECORDING_STOP_FAILED', async () => {
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession()]),
    );
    qr.query.mockRejectedValueOnce(new Error('db insert failed'));

    await expect(service.stopVideo('m1', 'sess-1', 'u1')).rejects.toThrow(
      InternalServerErrorException,
    );
    expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(qr.release).toHaveBeenCalledTimes(1);
  });
});
