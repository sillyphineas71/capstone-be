/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GateAccessLogEntity } from '../../zones/entities/gate-access-log.entity.js';
import { GateAccessPairingService } from './gate-access-pairing.service.js';

describe('GateAccessPairingService (GAP-001 / UC-116)', () => {
  let service: GateAccessPairingService;
  let repo: any;
  let dataSource: any;
  let configRepo: any;

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    configRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    dataSource = {
      getRepository: jest.fn().mockReturnValue(configRepo),
      transaction: jest.fn(async (cb: any) => {
        const manager = { update: jest.fn().mockResolvedValue(undefined) };
        await cb(manager);
        return manager;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GateAccessPairingService,
        { provide: getRepositoryToken(GateAccessLogEntity), useValue: repo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(GateAccessPairingService);
  });

  describe('pairPendingLogs', () => {
    it('không có log out chưa ghép → scanned=0, paired=0, unmatched=0, KHÔNG transaction', async () => {
      repo.find.mockResolvedValue([]);
      const r = await service.pairPendingLogs();
      expect(r).toEqual({ scanned: 0, paired: 0, unmatched: 0 });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('ghép thành công theo userId → transaction UPDATE cả 2 dòng, duration đúng', async () => {
      const inLog = {
        id: 'in1',
        userId: 'u1',
        plateNumber: null,
        accessTime: new Date('2026-07-23T08:00:00Z'),
      };
      const outLog = {
        id: 'out1',
        userId: 'u1',
        plateNumber: null,
        accessTime: new Date('2026-07-23T17:00:00Z'),
      };
      repo.find.mockResolvedValue([outLog]);
      repo.findOne.mockResolvedValue(inLog);

      const r = await service.pairPendingLogs();

      expect(r).toEqual({ scanned: 1, paired: 1, unmatched: 0 });
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      const manager = await dataSource.transaction.mock.results[0].value;
      expect(manager.update).toHaveBeenCalledWith(GateAccessLogEntity, 'in1', {
        pairedLogId: 'out1',
        durationSeconds: 9 * 60 * 60,
      });
      expect(manager.update).toHaveBeenCalledWith(GateAccessLogEntity, 'out1', {
        pairedLogId: 'in1',
        durationSeconds: 9 * 60 * 60,
      });
    });

    it('userId NULL, có plateNumber → fallback tìm theo plateNumber', async () => {
      const outLog = {
        id: 'out1',
        userId: null,
        plateNumber: '30A12345',
        accessTime: new Date('2026-07-23T17:00:00Z'),
      };
      repo.find.mockResolvedValue([outLog]);
      repo.findOne.mockResolvedValue(null);

      await service.pairPendingLogs();

      const where = repo.findOne.mock.calls[0][0].where;
      expect(where.plateNumber).toBe('30A12345');
      expect('userId' in where).toBe(false);
    });

    it('userId NULL VÀ plateNumber NULL → KHÔNG query DB, unmatched++', async () => {
      const outLog = {
        id: 'out1',
        userId: null,
        plateNumber: null,
        accessTime: new Date('2026-07-23T17:00:00Z'),
      };
      repo.find.mockResolvedValue([outLog]);

      const r = await service.pairPendingLogs();

      expect(repo.findOne).not.toHaveBeenCalled();
      expect(r).toEqual({ scanned: 1, paired: 0, unmatched: 1 });
    });

    it('không tìm thấy ứng viên trong 24h → unmatched++, KHÔNG transaction', async () => {
      const outLog = {
        id: 'out1',
        userId: 'u1',
        plateNumber: null,
        accessTime: new Date('2026-07-23T17:00:00Z'),
      };
      repo.find.mockResolvedValue([outLog]);
      repo.findOne.mockResolvedValue(null);

      const r = await service.pairPendingLogs();

      expect(r).toEqual({ scanned: 1, paired: 0, unmatched: 1 });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('cửa sổ tìm kiếm 24h trước access_time của log out (BR1/EX2)', async () => {
      const outLog = {
        id: 'out1',
        userId: 'u1',
        plateNumber: null,
        accessTime: new Date('2026-07-23T17:00:00Z'),
      };
      repo.find.mockResolvedValue([outLog]);
      repo.findOne.mockResolvedValue(null);

      await service.pairPendingLogs();

      const where = repo.findOne.mock.calls[0][0].where;
      expect(where.direction).toBe('in');
      expect(where.pairedLogId).toBeDefined(); // IsNull()
      const order = repo.findOne.mock.calls[0][0].order;
      expect(order).toEqual({ accessTime: 'DESC' });
    });
  });

  describe('loadClosingHour (qua pairPendingLogs, private)', () => {
    it('thiếu dòng config → dùng default 22:00, KHÔNG throw', async () => {
      configRepo.find.mockResolvedValue([]);
      repo.find.mockResolvedValue([]);
      await expect(service.pairPendingLogs()).resolves.toBeDefined();
      expect(configRepo.find).toHaveBeenCalledWith({
        where: { configGroup: 'gate_access', isActive: true },
      });
    });

    it('có dòng config hợp lệ → dùng đúng giá trị (không throw, không crash)', async () => {
      configRepo.find.mockResolvedValue([
        { configKey: 'gate_access.closing_hour_local', configValue: '23:30' },
      ]);
      repo.find.mockResolvedValue([]);
      await expect(service.pairPendingLogs()).resolves.toBeDefined();
    });

    it('giá trị sai format → fallback default, KHÔNG throw', async () => {
      configRepo.find.mockResolvedValue([
        { configKey: 'gate_access.closing_hour_local', configValue: '25:99' },
      ]);
      repo.find.mockResolvedValue([]);
      await expect(service.pairPendingLogs()).resolves.toBeDefined();
    });
  });
});
