import {
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { RoomUtilizationRateController } from '../controllers/room-utilization-rate.controller';
import { RoomUtilizationRateService } from '../services/room-utilization-rate.service';

describe('RoomUtilizationRateController', () => {
  let controller: RoomUtilizationRateController;
  let mockService: jest.Mocked<RoomUtilizationRateService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    mockService = {
      getUtilizationRate: jest.fn(),
    } as unknown as jest.Mocked<RoomUtilizationRateService>;

    controller = new RoomUtilizationRateController(mockService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getUtilizationRate', () => {
    it('valid request -> 200 with utilization rate response', async () => {
      const mockResult = {
        data: {
          currentPeriod: { from: '2026-06-01', to: '2026-06-30' },
          comparisonPeriod: { from: '2026-05-02', to: '2026-06-01' },
          comparisonHasNoData: false,
          summary: {
            reservationUtilizationRate: {
              current: 12.5,
              comparison: 6.3,
              deltaPercent: 100.0,
            },
            roomOccupancyRate: {
              current: 75.0,
              comparison: 50.0,
              deltaPercent: 50.0,
            },
            bookedHours: { current: 2.0, comparison: 1.0 },
            actualHours: { current: 1.5, comparison: 0.5 },
            availableHours: { current: 16.0, comparison: 16.0 },
          },
          trend: [],
          message: 'Thống kê tỷ lệ sử dụng phòng được truy xuất thành công',
        },
        message: 'Thống kê tỷ lệ sử dụng phòng được truy xuất thành công',
      };

      mockService.getUtilizationRate.mockResolvedValue(mockResult);

      const query = {
        preset: 'month',
      };

      const result = await controller.getUtilizationRate(query, {
        userId: mockUserId,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'Thống kê tỷ lệ sử dụng phòng được truy xuất thành công',
      );
      expect(result.data.summary.reservationUtilizationRate.current).toBe(12.5);
      expect(result.meta).toEqual({});
      expect(mockService.getUtilizationRate).toHaveBeenCalledWith(
        { userId: mockUserId },
        query,
      );
    });

    it('service throws ForbiddenException -> re-thrown as-is', async () => {
      mockService.getUtilizationRate.mockRejectedValue(
        new ForbiddenException({
          success: false,
          message: 'No access',
          error: { code: 'PERMISSION_DENIED', details: {} },
        }),
      );

      await expect(
        controller.getUtilizationRate({} as any, { userId: mockUserId }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('service throws unexpected error -> InternalServerErrorException', async () => {
      mockService.getUtilizationRate.mockRejectedValue(
        new Error('Unexpected error'),
      );

      await expect(
        controller.getUtilizationRate({} as any, { userId: mockUserId }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
