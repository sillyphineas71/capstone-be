import {
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { NoShowRateController } from '../controllers/no-show-rate.controller';
import { NoShowRateService } from '../services/no-show-rate.service';

describe('NoShowRateController', () => {
  let controller: NoShowRateController;
  let mockService: jest.Mocked<NoShowRateService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    mockService = {
      getNoShowRate: jest.fn(),
    } as unknown as jest.Mocked<NoShowRateService>;

    controller = new NoShowRateController(mockService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getNoShowRate', () => {
    it('valid request -> 200 with correct response shape', async () => {
      const mockResult = {
        data: {
          period: { from: '2026-06-01', to: '2026-06-30' },
          noShowCount: 5,
          totalBookings: 20,
          noShowRate: 25.0,
          trend: [
            {
              date: '2026-06-01',
              noShowCount: 1,
              totalBookings: 4,
              noShowRate: 25.0,
            },
          ],
          ranking: {
            rankBy: 'room',
            items: [
              {
                id: 'r1',
                name: 'Room 1',
                noShowCount: 5,
                totalBookings: 20,
                noShowRate: 25.0,
                lowSampleSize: false,
              },
            ],
            page: 1,
            limit: 20,
            total: 1,
            totalPages: 1,
          },
        },
        message: 'Thống kê tỷ lệ no-show được truy xuất thành công',
      };

      mockService.getNoShowRate.mockResolvedValue(mockResult);

      const query = {
        preset: 'month',
        rankBy: 'room',
      };

      const result = await controller.getNoShowRate(query, {
        userId: mockUserId,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'Thống kê tỷ lệ no-show được truy xuất thành công',
      );
      expect(result.data.noShowCount).toBe(5);
      expect(result.data.ranking.items[0]).toEqual({
        id: 'r1',
        name: 'Room 1',
        noShowCount: 5,
        totalBookings: 20,
        noShowRate: 25.0,
        lowSampleSize: false,
      });
      expect(result.meta).toEqual({});
      expect(mockService.getNoShowRate).toHaveBeenCalledWith(
        { userId: mockUserId },
        query,
      );
    });

    it('service throws ForbiddenException -> re-thrown as-is', async () => {
      const forbiddenError = new ForbiddenException({
        success: false,
        message: 'No access',
        error: { code: 'PERMISSION_DENIED', details: {} },
      });
      mockService.getNoShowRate.mockRejectedValue(forbiddenError);

      await expect(
        controller.getNoShowRate({} as any, { userId: mockUserId }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('service throws unexpected error -> InternalServerErrorException', async () => {
      mockService.getNoShowRate.mockRejectedValue(
        new Error('Database disconnect'),
      );

      await expect(
        controller.getNoShowRate({} as any, { userId: mockUserId }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
