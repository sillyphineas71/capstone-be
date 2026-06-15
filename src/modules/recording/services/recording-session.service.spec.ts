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
