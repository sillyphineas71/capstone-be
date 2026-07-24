/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ZoneEntity } from '../../zones/entities/zone.entity.js';
import { ZonePresenceEventEntity } from '../../zones/entities/zone-presence-event.entity.js';
import { GateAccessLogEntity } from '../../zones/entities/gate-access-log.entity.js';
import { IoTDeviceEntity } from '../../iot/entities/iot-device.entity.js';
import { CampusDashboardRepository } from './campus-dashboard.repository.js';

describe('CampusDashboardRepository (CDB-001 / UC-126)', () => {
  let repo: CampusDashboardRepository;
  let zoneRepo: any;
  let presenceRepo: any;
  let gateLogRepo: any;
  let deviceRepo: any;
  let configRepo: any;
  let dataSourceMock: any;

  const build = () => {
    zoneRepo = { find: jest.fn().mockResolvedValue([]) };
    presenceRepo = { find: jest.fn().mockResolvedValue([]) };
    gateLogRepo = { count: jest.fn().mockResolvedValue(0) };
    deviceRepo = { find: jest.fn().mockResolvedValue([]) };
    configRepo = { findOne: jest.fn().mockResolvedValue(null) };
    dataSourceMock = { getRepository: jest.fn(() => configRepo) };
  };

  const compile = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampusDashboardRepository,
        { provide: getRepositoryToken(ZoneEntity), useValue: zoneRepo },
        {
          provide: getRepositoryToken(ZonePresenceEventEntity),
          useValue: presenceRepo,
        },
        {
          provide: getRepositoryToken(GateAccessLogEntity),
          useValue: gateLogRepo,
        },
        { provide: getRepositoryToken(IoTDeviceEntity), useValue: deviceRepo },
        { provide: DataSource, useValue: dataSourceMock },
      ],
    }).compile();
    repo = module.get(CampusDashboardRepository);
  };

  beforeEach(async () => {
    build();
    await compile();
  });

  it('loadZoneHierarchy: filter building/floor được truyền đúng vào where', async () => {
    await repo.loadZoneHierarchy({ building: 'Tòa A', floor: '2' });
    expect(zoneRepo.find).toHaveBeenCalledWith({
      where: { deletedAt: expect.anything(), building: 'Tòa A', floor: '2' },
      order: { building: 'ASC', floor: 'ASC', zoneName: 'ASC' },
    });
  });

  it('loadZoneHierarchy: không filter → where chỉ có deletedAt', async () => {
    await repo.loadZoneHierarchy({});
    const callArg = zoneRepo.find.mock.calls[0][0];
    expect(callArg.where.building).toBeUndefined();
    expect(callArg.where.floor).toBeUndefined();
  });

  it('loadLatestCountEvent: trả row đầu tiên (order eventTime DESC, take 1)', async () => {
    presenceRepo.find.mockResolvedValue([{ id: 'evt-1' }]);
    const result = await repo.loadLatestCountEvent('zone-1');
    expect(result).toEqual({ id: 'evt-1' });
    expect(presenceRepo.find).toHaveBeenCalledWith({
      where: { zoneId: 'zone-1', eventType: 'count' },
      order: { eventTime: 'DESC' },
      take: 1,
    });
  });

  it('loadLatestCountEvent: không có row nào → null', async () => {
    presenceRepo.find.mockResolvedValue([]);
    const result = await repo.loadLatestCountEvent('zone-1');
    expect(result).toBeNull();
  });

  it('loadDevicesByZone: zoneIds rỗng → trả [] KHÔNG gọi repo', async () => {
    const result = await repo.loadDevicesByZone([]);
    expect(result).toEqual([]);
    expect(deviceRepo.find).not.toHaveBeenCalled();
  });

  it('loadDevicesByZone: zoneIds có giá trị → gọi repo.find với In(...)', async () => {
    deviceRepo.find.mockResolvedValue([{ id: 'd1' }]);
    const result = await repo.loadDevicesByZone(['z1', 'z2']);
    expect(result).toEqual([{ id: 'd1' }]);
    expect(deviceRepo.find).toHaveBeenCalled();
  });

  it('countGateLogsToday: gọi repo.count với zoneId/direction/accessTime đúng', async () => {
    gateLogRepo.count.mockResolvedValue(5);
    const startOfDay = new Date('2026-07-23T00:00:00Z');
    const result = await repo.countGateLogsToday('zone-1', 'in', startOfDay);
    expect(result).toBe(5);
    expect(gateLogRepo.count).toHaveBeenCalledWith({
      where: {
        zoneId: 'zone-1',
        direction: 'in',
        accessTime: expect.anything(),
      },
    });
  });

  it('loadStalenessMinutes: chưa có dòng cấu hình → fallback mặc định 15', async () => {
    configRepo.findOne.mockResolvedValue(null);
    const result = await repo.loadStalenessMinutes();
    expect(result).toBe(15);
  });

  it('loadStalenessMinutes: có dòng cấu hình hợp lệ → dùng giá trị đó', async () => {
    configRepo.findOne.mockResolvedValue({ configValue: '30' });
    const result = await repo.loadStalenessMinutes();
    expect(result).toBe(30);
  });

  it('loadStalenessMinutes: giá trị không hợp lệ (NaN/âm) → fallback mặc định 15', async () => {
    configRepo.findOne.mockResolvedValue({ configValue: 'not-a-number' });
    expect(await repo.loadStalenessMinutes()).toBe(15);

    configRepo.findOne.mockResolvedValue({ configValue: '-5' });
    expect(await repo.loadStalenessMinutes()).toBe(15);
  });
});
