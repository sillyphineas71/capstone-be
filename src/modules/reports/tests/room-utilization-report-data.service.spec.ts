import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RoomUtilizationReportDataService } from '../services/room-utilization-report-data.service.js';

describe('RoomUtilizationReportDataService', () => {
  let service: RoomUtilizationReportDataService;
  const mockQuery = jest.fn();

  beforeEach(async () => {
    mockQuery.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomUtilizationReportDataService,
        { provide: DataSource, useValue: { query: mockQuery } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(8) },
        },
      ],
    }).compile();
    service = module.get<RoomUtilizationReportDataService>(
      RoomUtilizationReportDataService,
    );
  });

  const params = {
    from: '2026-06-01',
    to: '2026-06-30',
    scope: { roomId: null },
  };

  describe('hasAnyBookingInScope (FR-017)', () => {
    it('returns true when EXISTS query finds a booking', async () => {
      mockQuery.mockResolvedValueOnce([{ exists: true }]);
      const result = await service.hasAnyBookingInScope(params);
      expect(result).toBe(true);
      // Assert the query filters on the REAL RoomBookingStatus enum values,
      // not the buggy ('confirmed','in_use') seen in the sibling precedent.
      expect(mockQuery.mock.calls[0][0]).toContain(
        "'approved','active','completed','released'",
      );
    });

    it('returns false when no booking exists in scope+range', async () => {
      mockQuery.mockResolvedValueOnce([{ exists: false }]);
      const result = await service.hasAnyBookingInScope(params);
      expect(result).toBe(false);
    });
  });

  describe('getUtilizationSection', () => {
    it('computes reservationUtilizationRate and roomOccupancyRate correctly', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // getOperatingHoursPerDay: no system_configs row -> ConfigService fallback (8)
        .mockResolvedValueOnce([{ count: '2' }]) // active room count
        .mockResolvedValueOnce([{ hours: '96' }]) // bookedHours
        .mockResolvedValueOnce([{ hours: '48' }]); // actualHours

      // availableHours = 8 (operating hours, from ConfigService fallback) * 30 days * 2 rooms = 480
      const result = await service.getUtilizationSection(params);

      expect(result.bookedHours).toBe(96);
      expect(result.actualHours).toBe(48);
      expect(result.reservationUtilizationRate).toBe(20); // 96/480*100
      expect(result.roomOccupancyRate).toBe(50); // 48/96*100
    });

    it('returns 0 rates when denominator is 0 (no active rooms)', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // getOperatingHoursPerDay fallback
        .mockResolvedValueOnce([{ count: '0' }])
        .mockResolvedValueOnce([{ hours: '0' }])
        .mockResolvedValueOnce([{ hours: '0' }]);

      const result = await service.getUtilizationSection(params);
      expect(result.reservationUtilizationRate).toBe(0);
      expect(result.roomOccupancyRate).toBe(0);
    });
  });

  describe('getNoShowSection', () => {
    it('computes noShowRate from noShowCount/totalBookings', async () => {
      mockQuery
        .mockResolvedValueOnce([{ count: '10' }]) // totalBookings
        .mockResolvedValueOnce([{ count: '3' }]); // noShowCount

      const result = await service.getNoShowSection(params);
      expect(result.totalBookings).toBe(10);
      expect(result.noShowCount).toBe(3);
      expect(result.noShowRate).toBe(30);
    });

    it('returns 0 when there are no bookings at all', async () => {
      mockQuery
        .mockResolvedValueOnce([{ count: '0' }])
        .mockResolvedValueOnce([{ count: '0' }]);
      const result = await service.getNoShowSection(params);
      expect(result.noShowRate).toBe(0);
    });
  });
});
