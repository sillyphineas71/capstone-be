/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SecurityAlertEntity } from '../../alerts/entities/security-alert.entity.js';
import { CampusDashboardRepository } from '../repositories/campus-dashboard.repository.js';
import { BusinessAdminSummaryService } from './business-admin-summary.service.js';

describe('BusinessAdminSummaryService (CDB-RS-001)', () => {
  let service: BusinessAdminSummaryService;
  let campusRepo: any;
  let alertRepo: any;
  let qbMock: any;

  const build = () => {
    qbMock = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    campusRepo = {
      countGateLogsAllZonesToday: jest.fn().mockResolvedValue(0),
      loadStalenessMinutes: jest.fn().mockResolvedValue(15),
      loadAllZonesWithLatestOccupancy: jest.fn().mockResolvedValue([]),
    };
    alertRepo = {
      createQueryBuilder: jest.fn(() => qbMock),
      count: jest.fn().mockResolvedValue(0),
    };
  };

  const compile = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessAdminSummaryService,
        { provide: CampusDashboardRepository, useValue: campusRepo },
        {
          provide: getRepositoryToken(SecurityAlertEntity),
          useValue: alertRepo,
        },
      ],
    }).compile();
    service = module.get(BusinessAdminSummaryService);
  };

  beforeEach(async () => {
    build();
    await compile();
  });

  it('gateTrafficToday: gọi countGateLogsAllZonesToday cho cả enter/leave', async () => {
    campusRepo.countGateLogsAllZonesToday
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(7);
    const result = await service.getSummary();
    expect(result.gateTrafficToday).toEqual({
      entriesToday: 10,
      exitsToday: 7,
    });
  });

  it('securityAlertsBySeverity: đủ 4 key kể cả khi DB không có alert nào', async () => {
    qbMock.getRawMany.mockResolvedValue([]);
    const result = await service.getSummary();
    expect(result.securityAlertsBySeverity).toEqual({
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    });
  });

  it('securityAlertsBySeverity: map đúng count theo severity có dữ liệu', async () => {
    qbMock.getRawMany.mockResolvedValue([
      { severity: 'high', count: '3' },
      { severity: 'medium', count: '5' },
    ]);
    const result = await service.getSummary();
    expect(result.securityAlertsBySeverity).toEqual({
      low: 0,
      medium: 5,
      high: 3,
      critical: 0,
    });
  });

  it('zoneOccupancy: SUM đúng, loại zone no_data khỏi totalCount nhưng vẫn đếm totalZoneCount', async () => {
    campusRepo.loadAllZonesWithLatestOccupancy.mockResolvedValue([
      {
        zone: { id: 'z1' },
        latestEvent: { occupancyCount: 5, eventTime: new Date() },
        devicesInZone: [],
      },
      {
        zone: { id: 'z2' },
        latestEvent: null,
        devicesInZone: [],
      },
    ]);
    const result = await service.getSummary();
    expect(result.zoneOccupancy.totalZoneCount).toBe(2);
    expect(result.zoneOccupancy.zonesWithDataCount).toBe(1);
    expect(result.zoneOccupancy.totalCount).toBe(5);
  });

  it('vehicleControlHitsToday: đếm qua security_alerts alertType=vehicle_control_match', async () => {
    alertRepo.count.mockResolvedValue(9);
    const result = await service.getSummary();
    expect(result.vehicleControlHitsToday).toBe(9);
    expect(alertRepo.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ alertType: 'vehicle_control_match' }),
      }),
    );
  });
});
