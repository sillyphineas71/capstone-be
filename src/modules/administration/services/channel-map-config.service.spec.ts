/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { BadRequestException } from '@nestjs/common';
import { ChannelMapConfigService } from './channel-map-config.service.js';
import { AuditLogsService } from './audit-logs.service.js';

describe('ChannelMapConfigService (F7, recon R4/R5)', () => {
  let service: ChannelMapConfigService;
  let dataSource: any;
  let em: any;
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const ROOM_UUID = '11111111-1111-1111-1111-111111111111';
  const ZONE_UUID = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    em = {
      query: jest.fn(),
    };

    dataSource = {
      manager: { query: jest.fn() },
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: any) => unknown) => cb(em)),
    };

    auditLogsService = {
      logAction: jest.fn(),
    } as unknown as jest.Mocked<AuditLogsService>;

    service = new ChannelMapConfigService(dataSource, auditLogsService);
  });

  describe('upsert() — key ngoài danh sách', () => {
    it('key không nằm trong 7 key → 400', async () => {
      await expect(
        service.upsert('some.random.key', 1, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('upsert() — threshold key', () => {
    it('value không phải số nguyên dương → 400', async () => {
      await expect(
        service.upsert('attendance.late_grace_minutes', -1, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.upsert('attendance.late_grace_minutes', 0, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.upsert('attendance.late_grace_minutes', 1.5, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.upsert('attendance.late_grace_minutes', '5' as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('value hợp lệ → INSERT (không có row cũ) → 200, đọc lại đúng', async () => {
      em.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT id, updated_at')) return Promise.resolve([]);
        if (sql.includes('INSERT INTO system_configs'))
          return Promise.resolve([
            {
              config_key: 'attendance.late_grace_minutes',
              config_value: '5',
              config_json: null,
              updated_at: new Date('2026-08-04T00:00:00Z'),
            },
          ]);
        return Promise.resolve([]);
      });

      const result = await service.upsert(
        'attendance.late_grace_minutes',
        5,
        'user-1',
      );
      expect(result.key).toBe('attendance.late_grace_minutes');
      expect(result.kind).toBe('threshold');
      expect(result.value).toBe(5);
      expect(auditLogsService.logAction).toHaveBeenCalledTimes(1);
    });

    it('key đã tồn tại → UPDATE in-place (idempotent)', async () => {
      em.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT id, updated_at'))
          return Promise.resolve([
            { id: 'cfg-1', updated_at: new Date('2026-08-01T00:00:00Z') },
          ]);
        if (sql.includes('UPDATE system_configs'))
          return Promise.resolve([
            {
              config_key: 'attendance.late_grace_minutes',
              config_value: '7',
              config_json: null,
              updated_at: new Date('2026-08-04T00:00:00Z'),
            },
          ]);
        return Promise.resolve([]);
      });

      const result = await service.upsert(
        'attendance.late_grace_minutes',
        7,
        'user-1',
      );
      expect(result.value).toBe(7);
      const updateCall = em.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('UPDATE system_configs'),
      );
      expect(updateCall).toBeDefined();
    });
  });

  describe('upsert() — map key: channel_room_map', () => {
    it('channelId không phải số → 400', async () => {
      await expect(
        service.upsert('ivss.channel_room_map', { abc: ROOM_UUID }, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('value không phải UUID → 400', async () => {
      await expect(
        service.upsert('ivss.channel_room_map', { '5': 'not-a-uuid' }, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('UUID hợp lệ nhưng room không tồn tại → 400', async () => {
      dataSource.manager.query.mockResolvedValue([]); // rooms lookup → rỗng
      await expect(
        service.upsert('ivss.channel_room_map', { '5': ROOM_UUID }, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('room tồn tại → 200, ghi config_json', async () => {
      dataSource.manager.query.mockResolvedValue([{ id: ROOM_UUID }]);
      em.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT id, updated_at')) return Promise.resolve([]);
        if (sql.includes('INSERT INTO system_configs'))
          return Promise.resolve([
            {
              config_key: 'ivss.channel_room_map',
              config_value: null,
              config_json: { '5': ROOM_UUID },
              updated_at: new Date(),
            },
          ]);
        return Promise.resolve([]);
      });

      const result = await service.upsert(
        'ivss.channel_room_map',
        { '5': ROOM_UUID },
        'u1',
      );
      expect(result.kind).toBe('map');
      expect(result.value).toEqual({ '5': ROOM_UUID });
    });
  });

  describe('upsert() — map key: channel_zone_map / channel_presence_zone_map', () => {
    it('zone tồn tại → 200', async () => {
      dataSource.manager.query.mockResolvedValue([{ id: ZONE_UUID }]);
      em.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT id, updated_at')) return Promise.resolve([]);
        if (sql.includes('INSERT INTO system_configs'))
          return Promise.resolve([
            {
              config_key: 'ivss.channel_presence_zone_map',
              config_value: null,
              config_json: { '7': ZONE_UUID },
              updated_at: new Date(),
            },
          ]);
        return Promise.resolve([]);
      });

      const result = await service.upsert(
        'ivss.channel_presence_zone_map',
        { '7': ZONE_UUID },
        'u1',
      );
      expect(result.value).toEqual({ '7': ZONE_UUID });
    });
  });

  describe('upsert() — role conflict channel_room_map ↔ channel_presence_zone_map (FIX 2026-08-11)', () => {
    const wireInsertSuccess = (
      configKey: string,
      configJson: Record<string, string>,
    ) => {
      em.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT id, updated_at')) return Promise.resolve([]);
        if (sql.includes('INSERT INTO system_configs'))
          return Promise.resolve([
            {
              config_key: configKey,
              config_value: null,
              config_json: configJson,
              updated_at: new Date(),
            },
          ]);
        return Promise.resolve([]);
      });
    };

    it('channelId đã tồn tại trong channel_presence_zone_map → PATCH channel_room_map bị 400 CHANNEL_MAP_ROLE_CONFLICT', async () => {
      dataSource.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM rooms'))
          return Promise.resolve([{ id: ROOM_UUID }]);
        if (sql.includes('FROM system_configs'))
          return Promise.resolve([{ config_json: { '5': ZONE_UUID } }]); // presence_zone_map đã có channel 5
        return Promise.resolve([]);
      });

      await expect(
        service.upsert('ivss.channel_room_map', { '5': ROOM_UUID }, 'u1'),
      ).rejects.toMatchObject({
        response: { error: { code: 'CHANNEL_MAP_ROLE_CONFLICT' } },
      });
    });

    it('đối xứng 2 chiều: channelId đã tồn tại trong channel_room_map → PATCH channel_presence_zone_map cũng bị 400', async () => {
      dataSource.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM zones'))
          return Promise.resolve([{ id: ZONE_UUID }]);
        if (sql.includes('FROM system_configs'))
          return Promise.resolve([{ config_json: { '5': ROOM_UUID } }]); // room_map đã có channel 5
        return Promise.resolve([]);
      });

      await expect(
        service.upsert(
          'ivss.channel_presence_zone_map',
          { '5': ZONE_UUID },
          'u1',
        ),
      ).rejects.toMatchObject({
        response: { error: { code: 'CHANNEL_MAP_ROLE_CONFLICT' } },
      });
    });

    it('error liệt kê rõ channelIds xung đột + conflictsWithKey', async () => {
      dataSource.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM rooms'))
          return Promise.resolve([{ id: ROOM_UUID }]);
        if (sql.includes('FROM system_configs'))
          return Promise.resolve([
            { config_json: { '5': ZONE_UUID, '6': ZONE_UUID } },
          ]);
        return Promise.resolve([]);
      });

      await expect(
        service.upsert(
          'ivss.channel_room_map',
          { '5': ROOM_UUID, '6': ROOM_UUID, '9': ROOM_UUID },
          'u1',
        ),
      ).rejects.toMatchObject({
        response: {
          error: {
            code: 'CHANNEL_MAP_ROLE_CONFLICT',
            details: {
              key: 'ivss.channel_room_map',
              conflictsWithKey: 'ivss.channel_presence_zone_map',
              channelIds: ['5', '6'], // '9' KHÔNG xung đột — không liệt kê nhầm
            },
          },
        },
      });
    });

    it('channelId hoàn toàn mới, không trùng gì → thành công như cũ (regression)', async () => {
      dataSource.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM rooms'))
          return Promise.resolve([{ id: ROOM_UUID }]);
        if (sql.includes('FROM system_configs'))
          return Promise.resolve([{ config_json: { '9': ZONE_UUID } }]); // channel khác, không trùng
        return Promise.resolve([]);
      });
      wireInsertSuccess('ivss.channel_room_map', { '5': ROOM_UUID });

      const result = await service.upsert(
        'ivss.channel_room_map',
        { '5': ROOM_UUID },
        'u1',
      );
      expect(result.value).toEqual({ '5': ROOM_UUID });
    });

    it('map đối nghịch chưa từng được cấu hình (DB rỗng) → không lỗi, coi như không có gì để giao nhau', async () => {
      dataSource.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM rooms'))
          return Promise.resolve([{ id: ROOM_UUID }]);
        if (sql.includes('FROM system_configs')) return Promise.resolve([]); // chưa có row nào
        return Promise.resolve([]);
      });
      wireInsertSuccess('ivss.channel_room_map', { '5': ROOM_UUID });

      const result = await service.upsert(
        'ivss.channel_room_map',
        { '5': ROOM_UUID },
        'u1',
      );
      expect(result.value).toEqual({ '5': ROOM_UUID });
    });

    it('key KHÔNG có conflictsWithKey (channel_zone_map) → KHÔNG query map đối nghịch, không bị ảnh hưởng', async () => {
      const calls: string[] = [];
      dataSource.manager.query.mockImplementation((sql: string) => {
        calls.push(sql);
        if (sql.includes('FROM zones'))
          return Promise.resolve([{ id: ZONE_UUID }]);
        return Promise.resolve([]);
      });
      wireInsertSuccess('ivss.channel_zone_map', { '5': ZONE_UUID });

      const result = await service.upsert(
        'ivss.channel_zone_map',
        { '5': ZONE_UUID },
        'u1',
      );
      expect(result.value).toEqual({ '5': ZONE_UUID });
      expect(calls.some((sql) => sql.includes('FROM system_configs'))).toBe(
        false,
      );
    });

    it('key threshold (attendance.late_grace_minutes) → KHÔNG có conflictsWithKey, KHÔNG query gì (giữ nguyên hiệu năng)', async () => {
      wireInsertSuccess('attendance.late_grace_minutes', {});
      em.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT id, updated_at')) return Promise.resolve([]);
        if (sql.includes('INSERT INTO system_configs'))
          return Promise.resolve([
            {
              config_key: 'attendance.late_grace_minutes',
              config_value: '5',
              config_json: null,
              updated_at: new Date(),
            },
          ]);
        return Promise.resolve([]);
      });

      await service.upsert('attendance.late_grace_minutes', 5, 'u1');
      expect(dataSource.manager.query).not.toHaveBeenCalled();
    });
  });

  describe('upsert() — map key: channel_direction_map', () => {
    it('direction hợp lệ (enter/leave/seen) → 200', async () => {
      em.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT id, updated_at')) return Promise.resolve([]);
        if (sql.includes('INSERT INTO system_configs'))
          return Promise.resolve([
            {
              config_key: 'ivss.channel_direction_map',
              config_value: null,
              config_json: { '1': 'enter', '2': 'leave', '3': 'seen' },
              updated_at: new Date(),
            },
          ]);
        return Promise.resolve([]);
      });

      const result = await service.upsert(
        'ivss.channel_direction_map',
        { '1': 'enter', '2': 'leave', '3': 'seen' },
        'u1',
      );
      expect(result.value).toEqual({ '1': 'enter', '2': 'leave', '3': 'seen' });
      // Direction map KHÔNG cần lookup DB — dataSource.manager.query không được gọi.
      expect(dataSource.manager.query).not.toHaveBeenCalled();
    });

    it('direction sai → 400', async () => {
      await expect(
        service.upsert('ivss.channel_direction_map', { '1': 'sideways' }, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list()', () => {
    it('trả đủ 7 key, key chưa set → value=null', async () => {
      dataSource.manager.query.mockResolvedValue([
        {
          config_key: 'attendance.late_grace_minutes',
          config_value: '5',
          config_json: null,
          updated_at: new Date('2026-08-01T00:00:00Z'),
        },
        {
          config_key: 'ivss.channel_room_map',
          config_value: null,
          config_json: { '5': ROOM_UUID },
          updated_at: new Date('2026-08-01T00:00:00Z'),
        },
      ]);

      const result = await service.list();
      expect(result).toHaveLength(7);

      const grace = result.find(
        (r) => r.key === 'attendance.late_grace_minutes',
      );
      expect(grace?.value).toBe(5);

      const roomMap = result.find((r) => r.key === 'ivss.channel_room_map');
      expect(roomMap?.value).toEqual({ '5': ROOM_UUID });

      const unset = result.find(
        (r) => r.key === 'campus.journey.gap_threshold_seconds',
      );
      expect(unset?.value).toBeNull();
      expect(unset?.updatedAt).toBeNull();
    });
  });
});
