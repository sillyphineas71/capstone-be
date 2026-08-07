/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { IvssOccupancyIngestService } from './ivss-occupancy-ingest.service.js';
import { OccupancyPersistenceService } from '../../presence/services/occupancy-persistence.service.js';
import { ZonePresenceWriterService } from '../../zones/services/zone-presence-writer.service.js';
import { CrowdAlertService } from '../../crowd-alert/services/crowd-alert.service.js';

const ROOM_UUID = '11111111-1111-1111-1111-111111111111';

describe('IvssOccupancyIngestService (IVSS-OCC-001 / A-OCC)', () => {
  let service: IvssOccupancyIngestService;
  let dataSourceMock: any;
  let persistMock: { persist: jest.Mock };
  let zonePresenceWriterMock: { writeCountEvent: jest.Mock };
  let crowdAlertMock: { evaluateZoneCountNow: jest.Mock };
  let bridgeRows: any[];
  let channelMap: Record<string, unknown> | null;
  let zoneChannelMap: Record<string, unknown> | null;

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
    // Mặc định KHÔNG map zone — các test AC-* có sẵn không quan tâm crowd-alert/zone,
    // tránh writeCountEvent bị gọi ngoài ý muốn ở những test đó.
    zoneChannelMap = null;

    dataSourceMock = {
      manager: {
        query: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('FROM iot_devices'))
            return Promise.resolve(bridgeRows);
          if (sql.includes("config_key = 'ivss.channel_room_map'"))
            return Promise.resolve([{ config_json: channelMap }]);
          if (sql.includes("config_key = 'ivss.channel_presence_zone_map'"))
            return Promise.resolve([{ config_json: zoneChannelMap }]);
          return Promise.resolve(undefined); // INSERT raw
        }),
      },
    };
    persistMock = {
      persist: jest.fn().mockResolvedValue({ statusChanged: true }),
    };
    zonePresenceWriterMock = {
      writeCountEvent: jest.fn().mockResolvedValue({ presenceId: 'zpe-1' }),
    };
    crowdAlertMock = {
      evaluateZoneCountNow: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssOccupancyIngestService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: OccupancyPersistenceService, useValue: persistMock },
        {
          provide: ZonePresenceWriterService,
          useValue: zonePresenceWriterMock,
        },
        { provide: CrowdAlertService, useValue: crowdAlertMock },
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

  // ── F3 (recon B5): channel_presence_zone_map → zone_presence_events(event_type='count') ──
  const ZONE_UUID = '22222222-2222-2222-2222-222222222222';

  it('F3: channel map zone → writeCountEvent gọi đúng (zoneId, count, eventTime)', async () => {
    zoneChannelMap = { '5': ZONE_UUID };
    await service.ingest(dto());
    expect(zonePresenceWriterMock.writeCountEvent).toHaveBeenCalledTimes(1);
    const arg = zonePresenceWriterMock.writeCountEvent.mock.calls[0][0];
    expect(arg.zoneId).toBe(ZONE_UUID);
    expect(arg.occupancyCount).toBe(3);
    expect(arg.eventTime).toBeInstanceOf(Date);
  });

  it('F3: channel KHÔNG map zone → writeCountEvent KHÔNG gọi (skip lặng)', async () => {
    zoneChannelMap = null;
    await service.ingest(dto());
    expect(zonePresenceWriterMock.writeCountEvent).not.toHaveBeenCalled();
  });

  it('F3: room KHÔNG map nhưng zone CÓ map → vẫn gọi writeCountEvent (2 mapping độc lập)', async () => {
    channelMap = { '99': ROOM_UUID }; // channel 5 không có trong room map
    zoneChannelMap = { '5': ZONE_UUID };
    await service.ingest(dto({ channelId: 5 }));
    expect(persistMock.persist).not.toHaveBeenCalled();
    expect(zonePresenceWriterMock.writeCountEvent).toHaveBeenCalledTimes(1);
  });

  // ── Đường crowd-alert TỨC THỜI (bên cạnh cron 5 phút — KHÔNG thay thế) ──
  describe('crowd-alert check (immediate)', () => {
    it('writeCountEvent thành công → gọi evaluateZoneCountNow đúng zoneId/occupancyCount/eventTime/sourceEventId=presenceId', async () => {
      zoneChannelMap = { '5': ZONE_UUID };
      await service.ingest(dto({ number: 42 }));
      expect(crowdAlertMock.evaluateZoneCountNow).toHaveBeenCalledTimes(1);
      const arg = crowdAlertMock.evaluateZoneCountNow.mock.calls[0][0];
      expect(arg.zoneId).toBe(ZONE_UUID);
      expect(arg.occupancyCount).toBe(42);
      expect(arg.eventTime).toBeInstanceOf(Date);
      expect(arg.sourceEventId).toBe('zpe-1'); // presenceId trả về từ writeCountEvent mock
    });

    it('channel KHÔNG map zone → KHÔNG gọi evaluateZoneCountNow', async () => {
      zoneChannelMap = null;
      await service.ingest(dto());
      expect(crowdAlertMock.evaluateZoneCountNow).not.toHaveBeenCalled();
    });

    it('writeCountEvent lỗi → KHÔNG gọi evaluateZoneCountNow (chỉ chạy SAU khi ghi thành công), lỗi vẫn trồi lên (ack-always ở controller)', async () => {
      zoneChannelMap = { '5': ZONE_UUID };
      zonePresenceWriterMock.writeCountEvent.mockRejectedValue(
        new Error('write boom'),
      );
      await expect(service.ingest(dto())).rejects.toThrow('write boom');
      expect(crowdAlertMock.evaluateZoneCountNow).not.toHaveBeenCalled();
    });

    it('evaluateZoneCountNow ném lỗi → ingest() KHÔNG ném (try/catch riêng, khác writeCountEvent)', async () => {
      zoneChannelMap = { '5': ZONE_UUID };
      crowdAlertMock.evaluateZoneCountNow.mockRejectedValue(
        new Error('crowd check boom'),
      );
      await expect(service.ingest(dto())).resolves.toBeUndefined();
      expect(zonePresenceWriterMock.writeCountEvent).toHaveBeenCalledTimes(1);
    });

    it('evaluateZoneCountNow trả true (vượt ngưỡng) → KHÔNG ảnh hưởng kết quả ingest() (best-effort)', async () => {
      zoneChannelMap = { '5': ZONE_UUID };
      crowdAlertMock.evaluateZoneCountNow.mockResolvedValue(true);
      await expect(service.ingest(dto())).resolves.toBeUndefined();
      expect(persistMock.persist).toHaveBeenCalledTimes(1);
    });
  });
});
