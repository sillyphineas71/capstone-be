import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { MeetingCountByPeriodController } from '../controllers/meeting-count-by-period.controller';
import { MeetingCountByPeriodService } from '../services/meeting-count-by-period.service';

describe('MeetingCountByPeriodController', () => {
  let controller: MeetingCountByPeriodController;
  let mockService: jest.Mocked<MeetingCountByPeriodService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    mockService = {
      getCountByPeriod: jest.fn(),
    } as unknown as jest.Mocked<MeetingCountByPeriodService>;

    controller = new MeetingCountByPeriodController(mockService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getCountByPeriod', () => {
    it('valid request -> 200 with correct response shape', async () => {
      const mockResult = {
        data: {
          total: 10,
          series: [
            {
              period: '2026-W23',
              count: 10,
            },
          ],
        },
        message: 'Thống kê số lượng cuộc họp được truy xuất thành công',
      };

      mockService.getCountByPeriod.mockResolvedValue(mockResult);

      const query = {
        granularity: 'week',
      };

      const result = await controller.getCountByPeriod(query as any, {
        userId: mockUserId,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Thống kê số lượng cuộc họp được truy xuất thành công');
      expect(result.data.total).toBe(10);
      expect(result.data.series[0]).toEqual({ period: '2026-W23', count: 10 });
      expect(result.meta).toEqual({});
      expect(mockService.getCountByPeriod).toHaveBeenCalledWith(
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
      mockService.getCountByPeriod.mockRejectedValue(forbiddenError);

      await expect(
        controller.getCountByPeriod({} as any, { userId: mockUserId }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('service throws unexpected error -> InternalServerErrorException', async () => {
      mockService.getCountByPeriod.mockRejectedValue(new Error('Database disconnect'));

      await expect(
        controller.getCountByPeriod({} as any, { userId: mockUserId }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
