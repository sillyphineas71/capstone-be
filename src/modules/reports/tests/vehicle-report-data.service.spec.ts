/**
 * vehicle-report-data.service.spec.ts
 *
 * Unit tests cho VehicleReportDataService (UC-128 T217, T218).
 * §0.2 spec: tất cả trạng thái (active+disabled), trừ đã xóa mềm.
 * §0.3 spec: filters.zoneId KHÔNG áp dụng cho listRegistrationsForExport.
 * NFR-004 spec: getTrafficStats gọi ĐÚNG VehicleTrafficStatsService.getStats, không fork logic.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { VehicleReportDataService } from '../services/vehicle-report-data.service.js';
import { VehicleTrafficStatsService } from '../../gate-access/services/vehicle-traffic-stats.service.js';

describe('VehicleReportDataService', () => {
  let service: VehicleReportDataService;
  const mockQuery = jest.fn();
  const mockDataSource = { query: mockQuery };
  const mockVehicleTrafficStatsService = { getStats: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehicleReportDataService,
        { provide: DataSource, useValue: mockDataSource },
        {
          provide: VehicleTrafficStatsService,
          useValue: mockVehicleTrafficStatsService,
        },
      ],
    }).compile();

    service = module.get<VehicleReportDataService>(VehicleReportDataService);
  });

  const baseParams = {
    from: '2026-07-01',
    to: '2026-07-31',
    filters: { vehicleType: null, zoneId: null },
  };

  describe('listRegistrationsForExport — §0.2', () => {
    it('always filters deleted_at IS NULL (excludes soft-deleted)', async () => {
      await service.listRegistrationsForExport(baseParams);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('vr.deleted_at IS NULL');
    });

    it('does NOT filter by status — active and disabled both included', async () => {
      await service.listRegistrationsForExport(baseParams);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).not.toContain('vr.status =');
    });

    it('§0.3: does NOT apply filters.zoneId even when provided', async () => {
      await service.listRegistrationsForExport({
        ...baseParams,
        filters: { vehicleType: null, zoneId: 'zone-1' },
      });
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).not.toContain('zone_id');
      expect(params).not.toContain('zone-1');
    });

    it('applies vehicleType filter when provided', async () => {
      await service.listRegistrationsForExport({
        ...baseParams,
        filters: { vehicleType: 'car', zoneId: null },
      });
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('vr.vehicle_type = $3');
      expect(params).toEqual(['2026-07-01', '2026-07-31', 'car']);
    });

    it('maps rows to camelCase export rows', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          plate_raw: '29A-123.45',
          plate_number: '29A12345',
          vehicle_type: 'car',
          status: 'disabled',
          note: 'test',
          created_at: new Date('2026-07-10T00:00:00Z'),
          employee_code: 'NV001',
          full_name: 'Nguyễn Văn A',
        },
      ]);

      const rows = await service.listRegistrationsForExport(baseParams);

      expect(rows).toEqual([
        {
          plateRaw: '29A-123.45',
          plateNumber: '29A12345',
          vehicleType: 'car',
          status: 'disabled',
          note: 'test',
          createdAt: new Date('2026-07-10T00:00:00Z'),
          ownerEmployeeCode: 'NV001',
          ownerFullName: 'Nguyễn Văn A',
        },
      ]);
    });
  });

  describe('getTrafficStats — NFR-004 (no fork logic)', () => {
    it('calls VehicleTrafficStatsService.getStats with correct params, returns its result unchanged', async () => {
      const mockResult = {
        summary: {
          total_events: 5,
          total_matched: 3,
          total_unmatched: 2,
          total_enter: 3,
          total_leave: 2,
          total_seen: 0,
          unique_vehicles: 4,
        },
        series: [],
      };
      mockVehicleTrafficStatsService.getStats.mockResolvedValue(mockResult);

      const result = await service.getTrafficStats({
        from: '2026-07-01',
        to: '2026-07-31',
        filters: { vehicleType: 'car', zoneId: 'zone-1' },
      });

      expect(mockVehicleTrafficStatsService.getStats).toHaveBeenCalledWith({
        from: '2026-07-01',
        to: '2026-07-31',
        zoneId: 'zone-1',
        vehicleType: 'car',
        groupBy: 'day',
      });
      expect(result).toBe(mockResult);
    });

    it('passes undefined (not null) for absent filters', async () => {
      mockVehicleTrafficStatsService.getStats.mockResolvedValue({
        summary: {} as any,
        series: [],
      });

      await service.getTrafficStats(baseParams);

      expect(mockVehicleTrafficStatsService.getStats).toHaveBeenCalledWith(
        expect.objectContaining({ zoneId: undefined, vehicleType: undefined }),
      );
    });
  });
});
