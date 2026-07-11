import {
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { OnTimeRateController } from '../controllers/on-time-rate.controller';
import { OnTimeRateService } from '../services/on-time-rate.service';

describe('OnTimeRateController', () => {
  let controller: OnTimeRateController;
  let mockService: jest.Mocked<OnTimeRateService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';
  const mockTargetId = '00000000-0000-0000-0000-000000000002';

  beforeEach(() => {
    mockService = {
      getOnTimeRate: jest.fn(),
      getLateHistory: jest.fn(),
    } as unknown as jest.Mocked<OnTimeRateService>;

    controller = new OnTimeRateController(mockService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getOnTimeRate', () => {
    it('valid request -> 200 with correct response shape', async () => {
      const mockResult = {
        data: {
          period: { from: '2026-06-01', to: '2026-06-30' },
          graceMinutes: 5,
          onTimeCount: 385,
          lateCount: 50,
          absentCount: 32,
          totalRequiredParticipants: 467,
          onTimeRate: 82.4,
          trend: [],
          lateByHourOfDay: [],
          lateByDepartment: [],
        },
        message: 'Thống kê tỷ lệ tham dự đúng giờ được truy xuất thành công',
      };

      mockService.getOnTimeRate.mockResolvedValue(mockResult);

      const query = {
        preset: 'month',
        graceMinutes: 5,
      };

      const result = await controller.getOnTimeRate(query, {
        userId: mockUserId,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'Thống kê tỷ lệ tham dự đúng giờ được truy xuất thành công',
      );
      expect(result.data.onTimeRate).toBe(82.4);
      expect(result.meta).toEqual({});
      expect(mockService.getOnTimeRate).toHaveBeenCalledWith(
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
      mockService.getOnTimeRate.mockRejectedValue(forbiddenError);

      await expect(
        controller.getOnTimeRate({} as any, { userId: mockUserId }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('service throws unexpected error -> InternalServerErrorException', async () => {
      mockService.getOnTimeRate.mockRejectedValue(
        new Error('Database disconnect'),
      );

      await expect(
        controller.getOnTimeRate({} as any, { userId: mockUserId }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getLateHistory', () => {
    it('valid request -> 200 with late history response', async () => {
      const mockResult = {
        data: {
          user: {
            userId: mockTargetId,
            fullName: 'Target User',
            email: 't@co.com',
          },
          period: { from: '2026-06-01', to: '2026-06-30' },
          lateMeetings: [],
        },
        message: 'Lịch sử đi muộn của nhân sự được truy xuất thành công',
      };

      mockService.getLateHistory.mockResolvedValue(mockResult);

      const query = {
        preset: 'month',
      };

      const result = await controller.getLateHistory(mockTargetId, query, {
        userId: mockUserId,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'Lịch sử đi muộn của nhân sự được truy xuất thành công',
      );
      expect(result.data.user.fullName).toBe('Target User');
      expect(mockService.getLateHistory).toHaveBeenCalledWith(
        { userId: mockUserId },
        mockTargetId,
        query,
      );
    });

    it('service throws NotFoundException -> re-thrown as-is', async () => {
      mockService.getLateHistory.mockRejectedValue(
        new NotFoundException({ success: false, message: 'User not found' }),
      );

      await expect(
        controller.getLateHistory(mockTargetId, {} as any, {
          userId: mockUserId,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
