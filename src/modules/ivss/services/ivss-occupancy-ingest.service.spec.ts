/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { IvssOccupancyIngestService } from './ivss-occupancy-ingest.service.js';
import { OccupancyPersistenceService } from '../../presence/services/occupancy-persistence.service.js';

const ROOM_UUID = '11111111-1111-1111-1111-111111111111';

describe('IvssOccupancyIngestService (IVSS-OCC-001 / A-OCC)', () => {
  let service: IvssOccupancyIngestService;
  let dataSourceMock: any;
  let persistMock: { persist: jest.Mock };
  let bridgeRows: any[];
  let channelMap: Record<string, unknown> | null;

  const dto = (over: any = {}) => ({
    type: 'occupancy',
    channelId: 5,
    number: 3,
    enteredNumber: 1,
    exitedNumber: 0,
    eventAction: 'stat',
    utc: '2026-06-30T09:00:00.000Z',
    ...over,
  });

  const rawInsertCall = () =>
    dataSourceMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO iot_device_events'),
    );

  beforeEach(async () => {
    bridgeRows = [{ id: 'bridge-1' }];
    channelMap = { '5': ROOM_UUID };

    dataSourceMock = {
      manager: {
        query: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('FROM iot_devices'))
            return Promise.resolve(bridgeRows);
          if (sql.includes('FROM system_configs'))
            return Promise.resolve([{ config_json: channelMap }]);
          return Promise.resolve(undefined); // INSERT raw
        }),
      },
    };
    persistMock = {
      persist: jest.fn().mockResolvedValue({ statusChanged: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssOccupancyIngestService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: OccupancyPersistenceService, useValue: persistMock },
      ],
    }).compile();
    service = module.get(IvssOccupancyIngestService);
  });

  afterEach(() => jest.clearAllMocks());

  it('AC-04: channel có map → persist gọi đúng (roomId, null, count, null, eventTime)', async () => {
    await service.ingest(dto());
    expect(persistMock.persist).toHaveBeenCalledTimes(1);
    const arg = persistMock.persist.mock.calls[0][0];
    expect(arg.roomId).toBe(ROOM_UUID);
    expect(arg.meetingId).toBeNull();
    expect(arg.occupancyCount).toBe(3);
    expect(arg.confidence).toBeNull();
    expect(arg.eventTime).toBeInstanceOf(Date);
  });

  it('AC-11: raw ghi sớm — event_type ivss_occupancy_event, room_id NULL, payload có entered/exited', async () => {
    await service.ingest(dto());
    const call = rawInsertCall();
    expect(call).toBeDefined();
    expect(String(call[0])).toContain("'ivss_occupancy_event'");
    expect(String(call[0])).toContain('VALUES ($1, NULL, NULL'); // room_id/meeting_id NULL
    const payload = String(call[1][2]); // payload_json param ($3)
    expect(payload).toContain('enteredNumber');
    expect(payload).toContain('exitedNumber');
    expect(payload).toContain('channelId');
  });

  it('AC-05: channel KHÔNG map → vẫn ghi raw, persist KHÔNG gọi', async () => {
    channelMap = { '99': ROOM_UUID }; // channel 5 không có
    await service.ingest(dto({ channelId: 5 }));
    expect(rawInsertCall()).toBeDefined(); // raw vẫn ghi
    expect(persistMock.persist).not.toHaveBeenCalled();
  });

  it('AC-12: device IVSS-BRIDGE chưa seed → KHÔNG ghi raw, KHÔNG persist', async () => {
    bridgeRows = [];
    await service.ingest(dto());
    expect(rawInsertCall()).toBeUndefined();
    expect(persistMock.persist).not.toHaveBeenCalled();
  });

  it('AC-10: utc trong skew → eventTime = utc; utc lệch xa → fallback now', async () => {
    // utc trong ±1h (skew) → dùng đúng utc.
    const validUtc = new Date(Date.now() - 60 * 1000).toISOString();
    await service.ingest(dto({ utc: validUtc }));
    const t1 = persistMock.persist.mock.calls[0][0].eventTime as Date;
    expect(t1.toISOString()).toBe(validUtc);

    persistMock.persist.mockClear();
    await service.ingest(dto({ utc: '2000-01-01T00:00:00.000Z' })); // lệch >1h → now
    const t2 = persistMock.persist.mock.calls[0][0].eventTime as Date;
    expect(Math.abs(Date.now() - t2.getTime())).toBeLessThan(60 * 1000);
  });

  it('AC-17: count bất thường → persist ném BadRequest → trồi lên (raw vẫn ghi)', async () => {
    persistMock.persist.mockRejectedValue(
      new BadRequestException({ code: 'INVALID_OCCUPANCY_PAYLOAD' }),
    );
    await expect(service.ingest(dto({ number: -1 }))).rejects.toThrow(
      BadRequestException,
    );
    expect(rawInsertCall()).toBeDefined(); // raw đã ghi TRƯỚC persist
  });

  it('AC-14: confidence luôn null cho IVSS', async () => {
    await service.ingest(dto());
    expect(persistMock.persist.mock.calls[0][0].confidence).toBeNull();
  });

  it('map value KHÔNG phải UUID hợp lệ → coi như chưa map (skip persist, raw vẫn ghi)', async () => {
    channelMap = { '5': 'not-a-uuid' }; // value sai UUID → filter loại
    await service.ingest(dto({ channelId: 5 }));
    expect(rawInsertCall()).toBeDefined();
    expect(persistMock.persist).not.toHaveBeenCalled();
  });

  it('config_json rỗng/null → không map → skip persist', async () => {
    channelMap = null;
    await service.ingest(dto());
    expect(persistMock.persist).not.toHaveBeenCalled();
  });

  it('thiếu enteredNumber/exitedNumber → payload null các field đó (không vỡ)', async () => {
    await service.ingest({
      type: 'occupancy',
      channelId: 5,
      number: 2,
      utc: new Date().toISOString(),
    });
    const payload = String(rawInsertCall()[1][2]);
    expect(payload).toContain('"enteredNumber":null');
    expect(payload).toContain('"exitedNumber":null');
  });
});
