/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GateAccessLogEntity } from '../../zones/entities/gate-access-log.entity.js';
import { VehicleRegistrationEntity } from '../../anpr/entities/vehicle-registration.entity.js';
import { EmployeeSummaryService } from './employee-summary.service.js';

describe('EmployeeSummaryService (CDB-RS-001)', () => {
  let service: EmployeeSummaryService;
  let gateLogRepo: any;
  let vehicleRepo: any;
  let dataSourceMock: any;

  const build = () => {
    gateLogRepo = { find: jest.fn().mockResolvedValue([]) };
    vehicleRepo = { find: jest.fn().mockResolvedValue([]) };
    dataSourceMock = { query: jest.fn().mockResolvedValue([{ count: '0' }]) };
  };

  const compile = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeSummaryService,
        {
          provide: getRepositoryToken(GateAccessLogEntity),
          useValue: gateLogRepo,
        },
        {
          provide: getRepositoryToken(VehicleRegistrationEntity),
          useValue: vehicleRepo,
        },
        { provide: DataSource, useValue: dataSourceMock },
      ],
    }).compile();
    service = module.get(EmployeeSummaryService);
  };

  beforeEach(async () => {
    build();
    await compile();
  });

  it('vehicleStatus: chưa đăng ký xe → null, KHÔNG lỗi', async () => {
    vehicleRepo.find.mockResolvedValue([]);
    const result = await service.getSummary('user-1');
    expect(result.vehicleStatus).toBeNull();
  });

  it('vehicleStatus: có xe → trả plateNumber + status literal (active/disabled)', async () => {
    vehicleRepo.find.mockResolvedValue([
      { plateNumber: '29A12345', status: 'disabled' },
    ]);
    const result = await service.getSummary('user-1');
    expect(result.vehicleStatus).toEqual({
      plateNumber: '29A12345',
      status: 'disabled',
    });
    expect(vehicleRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { createdAt: 'DESC' }, take: 1 }),
    );
  });

  it('gateAccessToday: sort ASC theo accessTime, map đúng direction', async () => {
    const t1 = new Date('2026-07-29T01:00:00Z');
    const t2 = new Date('2026-07-29T08:00:00Z');
    gateLogRepo.find.mockResolvedValue([
      { direction: 'enter', accessTime: t1 },
      { direction: 'leave', accessTime: t2 },
    ]);
    const result = await service.getSummary('user-1');
    expect(result.gateAccessToday).toEqual([
      { direction: 'enter', accessTime: t1.toISOString() },
      { direction: 'leave', accessTime: t2.toISOString() },
    ]);
    expect(gateLogRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { accessTime: 'ASC' } }),
    );
  });

  it('meetingsToday: query loại status=cancelled', async () => {
    dataSourceMock.query.mockResolvedValue([{ count: '3' }]);
    const result = await service.getSummary('user-1');
    expect(result.meetingsToday).toBe(3);
    const sql = dataSourceMock.query.mock.calls[0][0] as string;
    expect(sql).toContain("m.status <> 'cancelled'");
  });
});
