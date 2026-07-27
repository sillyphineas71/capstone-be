/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ZonePresenceWriterService } from './zone-presence-writer.service.js';

describe('ZonePresenceWriterService (ZPW-001 / UC-109)', () => {
  let service: ZonePresenceWriterService;
  let ds: any;
  let qr: any;

  beforeEach(async () => {
    qr = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: { query: jest.fn().mockResolvedValue([{ id: 'zpe-1' }]) },
    };
    ds = {
      manager: {
        query: jest.fn().mockResolvedValue([{ zone_type: 'corridor' }]),
      },
      createQueryRunner: jest.fn(() => qr),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZonePresenceWriterService,
        { provide: DataSource, useValue: ds },
      ],
    }).compile();
    service = module.get(ZonePresenceWriterService);
  });

  const input = (over: any = {}) => ({
    zoneId: 'z-area',
    userId: 'u1',
    eventTime: new Date('2026-07-26T09:00:00.000Z'),
    deviceId: 'dev1',
    metadata: {
      channelId: 3,
      szUid: 'sz9',
      similarity: 92,
      sourceEventId: 'evt1',
    },
    ...over,
  });

  describe('resolvePresenceZone (QC-5)', () => {
    for (const t of ['corridor', 'lobby', 'parking']) {
      it(`zone type=${t} → valid`, async () => {
        ds.manager.query.mockResolvedValueOnce([{ zone_type: t }]);
        expect(await service.resolvePresenceZone('z')).toEqual({ valid: true });
      });
    }

    it('zone type=gate → zone_wrong_type', async () => {
      ds.manager.query.mockResolvedValueOnce([{ zone_type: 'gate' }]);
      expect(await service.resolvePresenceZone('z')).toEqual({
        valid: false,
        reason: 'zone_wrong_type',
      });
    });

    it('zone type=room → zone_wrong_type', async () => {
      ds.manager.query.mockResolvedValueOnce([{ zone_type: 'room' }]);
      expect(await service.resolvePresenceZone('z')).toEqual({
        valid: false,
        reason: 'zone_wrong_type',
      });
    });

    it('zone không tồn tại / đã xoá mềm → zone_wrong_type (SELECT lọc deleted_at IS NULL)', async () => {
      ds.manager.query.mockResolvedValueOnce([]);
      expect(await service.resolvePresenceZone('z')).toEqual({
        valid: false,
        reason: 'zone_wrong_type',
      });
      expect(String(ds.manager.query.mock.calls[0][0])).toContain(
        'deleted_at IS NULL',
      );
    });
  });

  describe('writeAppearEvent', () => {
    it('zone khu vực hợp lệ → INSERT appear + trả presenceId', async () => {
      const r = await service.writeAppearEvent(input());
      expect(r).toEqual({ presenceId: 'zpe-1' });
      const ins = qr.manager.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('INSERT INTO zone_presence_events'),
      );
      expect(ins).toBeDefined();
      const sql = String(ins[0]);
      expect(sql).toContain("'appear'");
      // occupancy_count NULL literal + KHÔNG cột event_id (nhánh B).
      expect(sql).not.toContain('event_id');
      // event_time (param index 3) = eventTime truyền vào (KHÔNG now()).
      expect(ins[1][3]).toEqual(new Date('2026-07-26T09:00:00.000Z'));
      expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
      expect(qr.release).toHaveBeenCalledTimes(1);
    });

    it('metadata (gồm sourceEventId) ghi vào metadata_json param', async () => {
      await service.writeAppearEvent(input());
      const ins = qr.manager.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('INSERT INTO zone_presence_events'),
      );
      // metadata_json là param cuối (index 4).
      const meta = JSON.parse(ins[1][4]);
      expect(meta).toEqual({
        channelId: 3,
        szUid: 'sz9',
        similarity: 92,
        sourceEventId: 'evt1',
      });
    });

    it('zone sai type (defense) → ném, KHÔNG INSERT', async () => {
      ds.manager.query.mockResolvedValueOnce([{ zone_type: 'gate' }]);
      await expect(service.writeAppearEvent(input())).rejects.toThrow(
        'zone_wrong_type',
      );
      expect(qr.manager.query).not.toHaveBeenCalled();
    });

    it('INSERT lỗi → rollback + release + ném lại', async () => {
      qr.manager.query.mockRejectedValueOnce(new Error('db boom'));
      await expect(service.writeAppearEvent(input())).rejects.toThrow(
        'db boom',
      );
      expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(qr.release).toHaveBeenCalledTimes(1);
    });
  });
});
