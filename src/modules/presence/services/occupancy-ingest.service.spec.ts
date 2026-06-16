/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { OccupancyIngestService } from './occupancy-ingest.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';

const TOKEN = 'secret-token';
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');

describe('OccupancyIngestService (OCC-001 / UC-75)', () => {
  let service: OccupancyIngestService;
  let dataSourceMock: any;
  let qr: any;
  let wsMock: any;
  let device: any;
  let bookingRows: any[];
  let roomUpdateRows: any[]; // UPDATE rooms RETURNING id → status đổi nếu có row.

  const makeInput = (bodyOver: any = {}, headerOver: any = {}) => ({
    headers: {
      'x-device-code': 'CAM-1',
      'x-callback-token': TOKEN,
      ...headerOver,
    },
    body: {
      roomId: 'room-1',
      occupancyCount: 5,
      eventTime: new Date().toISOString(),
      ...bodyOver,
    },
    query: {},
    params: {},
  });

  // có gọi INSERT iot_device_events (raw) không?
  const rawInserted = () =>
    dataSourceMock.manager.query.mock.calls.some((c: any[]) =>
      String(c[0]).includes('INSERT INTO iot_device_events'),
    );
  const qrCalled = (needle: string) =>
    qr.query.mock.calls.some((c: any[]) => String(c[0]).includes(needle));

  beforeEach(async () => {
    device = {
      id: 'dev-1',
      device_type: 'room_camera',
      room_id: 'room-1',
      status: 'online',
      metadata_json: {
        camera_service_config: { callback_token_hash: TOKEN_HASH },
      },
    };
    bookingRows = [{ booking_id: 'bk-1', meeting_id: 'mt-1' }];
    // Shape THẬT của UPDATE...RETURNING qua TypeORM: [rows, affectedCount].
    roomUpdateRows = [[{ id: 'room-1' }], 1]; // status đổi → emit room.status.updated.

    qr = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM room_bookings'))
          return Promise.resolve(bookingRows);
        if (sql.includes('UPDATE rooms'))
          return Promise.resolve(roomUpdateRows);
        return Promise.resolve(undefined);
      }),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    dataSourceMock = {
      manager: {
        query: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('FROM iot_devices'))
            return Promise.resolve([device]);
          return Promise.resolve(undefined);
        }),
      },
      createQueryRunner: jest.fn().mockReturnValue(qr),
    };
    wsMock = { emitToRoom: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OccupancyIngestService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: WebsocketService, useValue: wsMock },
      ],
    }).compile();
    service = module.get(OccupancyIngestService);
  });

  afterEach(() => jest.clearAllMocks());

  it('có meeting: raw + room_events + presence + usage + occupied + WS', async () => {
    const r = await service.ingest(makeInput());
    expect(r).toEqual({ accepted: true });
    expect(rawInserted()).toBe(true);
    expect(qrCalled('INSERT INTO room_events')).toBe(true);
    expect(qrCalled('INSERT INTO presence_snapshots')).toBe(true);
    expect(qrCalled('UPDATE room_booking_usages')).toBe(true);
    expect(qrCalled('UPDATE rooms')).toBe(true);
    expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'room:room-1',
      'room.occupancy.updated',
      expect.objectContaining({ roomId: 'room-1', occupancyCount: 5 }),
    );
  });

  it('RMS-001: status đổi (UPDATE trả row) → emit room.status.updated', async () => {
    bookingRows = [];
    await service.ingest(makeInput());
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'room:room-1',
      'room.status.updated',
      expect.objectContaining({ roomId: 'room-1', status: 'occupied' }),
    );
  });

  it('RMS-001: đã occupied (UPDATE trả []) → KHÔNG emit room.status.updated', async () => {
    bookingRows = [];
    roomUpdateRows = [[], 0]; // status KHÔNG đổi (0 row).
    await service.ingest(makeInput());
    const statusEmits = wsMock.emitToRoom.mock.calls.filter(
      (c: any[]) => c[1] === 'room.status.updated',
    );
    expect(statusEmits).toHaveLength(0);
    // vẫn phát occupancy.updated.
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'room:room-1',
      'room.occupancy.updated',
      expect.anything(),
    );
  });

  it('không meeting: chỉ raw + room_events + occupied (KHÔNG presence/usage)', async () => {
    bookingRows = [];
    const r = await service.ingest(makeInput());
    expect(r).toEqual({ accepted: true });
    expect(qrCalled('INSERT INTO room_events')).toBe(true);
    expect(qrCalled('INSERT INTO presence_snapshots')).toBe(false);
    expect(qrCalled('UPDATE room_booking_usages')).toBe(false);
    expect(qrCalled('UPDATE rooms')).toBe(true);
  });

  it('count=0: room_events ghi, KHÔNG set occupied', async () => {
    bookingRows = [];
    await service.ingest(makeInput({ occupancyCount: 0 }));
    expect(qrCalled('INSERT INTO room_events')).toBe(true);
    expect(qrCalled('UPDATE rooms')).toBe(false);
  });

  it('token sai → 401, KHÔNG lưu raw', async () => {
    await expect(
      service.ingest(makeInput({}, { 'x-callback-token': 'wrong' })),
    ).rejects.toThrow(UnauthorizedException);
    expect(rawInserted()).toBe(false);
  });

  it('device không tồn tại → 404, KHÔNG raw', async () => {
    dataSourceMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM iot_devices')) return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    await expect(service.ingest(makeInput())).rejects.toThrow(
      NotFoundException,
    );
    expect(rawInserted()).toBe(false);
  });

  it('count âm → 400 (sau khi đã lưu raw)', async () => {
    await expect(
      service.ingest(makeInput({ occupancyCount: -1 })),
    ).rejects.toThrow(BadRequestException);
    expect(rawInserted()).toBe(true); // raw đã lưu trước validate
    expect(qr.startTransaction).not.toHaveBeenCalled();
  });

  it('device.room_id mismatch → 403, KHÔNG raw', async () => {
    device.room_id = 'other-room';
    await expect(service.ingest(makeInput())).rejects.toThrow(
      ForbiddenException,
    );
    expect(rawInserted()).toBe(false);
  });

  it('business lỗi (transaction) → rollback, raw vẫn còn', async () => {
    qr.query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO room_events'))
        return Promise.reject(new Error('db boom'));
      return Promise.resolve(undefined);
    });
    await expect(service.ingest(makeInput())).rejects.toThrow('db boom');
    expect(rawInserted()).toBe(true);
    expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it('WS lỗi → vẫn trả 202', async () => {
    wsMock.emitToRoom.mockImplementation(() => {
      throw new Error('ws down');
    });
    const r = await service.ingest(makeInput());
    expect(r).toEqual({ accepted: true });
    expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('SEC: token KHÔNG nằm trong payload raw lưu (gửi qua header)', async () => {
    await service.ingest(makeInput());
    const rawCall = dataSourceMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO iot_device_events'),
    );
    const payloadJson = rawCall[1][4] as string; // payload_json param
    expect(payloadJson).not.toContain(TOKEN);
  });

  it('SEC: token gửi trong BODY → redact khỏi payload_json (202)', async () => {
    bookingRows = [];
    const r = await service.ingest(
      makeInput({ callbackToken: TOKEN }, { 'x-callback-token': undefined }),
    );
    expect(r).toEqual({ accepted: true });
    const rawCall = dataSourceMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO iot_device_events'),
    );
    const payloadJson = rawCall[1][4] as string;
    expect(payloadJson).not.toContain(TOKEN); // token đã bị mask '***'
    expect(payloadJson).toContain('***');
  });

  it('thiếu deviceCode → 400, KHÔNG resolve device', async () => {
    const input = makeInput({}, { 'x-device-code': undefined });
    await expect(service.ingest(input)).rejects.toThrow(BadRequestException);
  });

  it('thiếu token → 401', async () => {
    await expect(
      service.ingest(makeInput({}, { 'x-callback-token': undefined })),
    ).rejects.toThrow(UnauthorizedException);
    expect(rawInserted()).toBe(false);
  });

  it('device disabled → 403, KHÔNG raw', async () => {
    device.status = 'disabled';
    await expect(service.ingest(makeInput())).rejects.toThrow(
      ForbiddenException,
    );
    expect(rawInserted()).toBe(false);
  });

  it('device offline (heartbeat trễ) → vẫn nhận (202)', async () => {
    device.status = 'offline';
    bookingRows = [];
    const r = await service.ingest(makeInput());
    expect(r).toEqual({ accepted: true });
    expect(rawInserted()).toBe(true);
  });

  it('eventTime lệch xa server → fallback now (vẫn 202)', async () => {
    bookingRows = [];
    const r = await service.ingest(
      makeInput({ eventTime: '2000-01-01T00:00:00Z' }),
    );
    expect(r).toEqual({ accepted: true });
  });
});
