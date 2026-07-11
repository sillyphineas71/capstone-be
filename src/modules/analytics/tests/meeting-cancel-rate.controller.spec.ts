import {
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { MeetingCancelRateController } from '../controllers/meeting-cancel-rate.controller';
import { MeetingCancelRateService } from '../services/meeting-cancel-rate.service';

describe('MeetingCancelRateController', () => {
  let controller: MeetingCancelRateController;
  let mockService: jest.Mocked<MeetingCancelRateService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    mockService = {
      getCancelRate: jest.fn(),
    } as unknown as jest.Mocked<MeetingCancelRateService>;

    controller = new MeetingCancelRateController(mockService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getCancelRate', () => {
    it('valid request -> 200 with correct response shape', async () => {
      const mockResult = {
        data: {
          period: { from: '2026-06-01', to: '2026-06-30' },
          totalMeetingCount: 10,
          cancelledCount: 3,
          cancelRate: 30.0,
          series: [
            {
              period: '2026-W23',
              totalCount: 10,
              cancelledCount: 3,
              cancelRate: 30.0,
            },
          ],
          topOrganizers: [
            {
              userId: 'u1',
              email: 'o1@co.com',
              fullName: 'Org 1',
              organizedCount: 5,
              cancelledCount: 3,
              cancelRate: 60.0,
            },
          ],
          topDepartments: [
            {
              departmentId: 'd1',
              departmentName: 'Dept 1',
              organizedCount: 5,
              cancelledCount: 3,
              cancelRate: 60.0,
            },
          ],
        },
        message: 'Thống kê tỷ lệ cuộc họp bị hủy được truy xuất thành công',
      };

      mockService.getCancelRate.mockResolvedValue(mockResult);

      const query = {
        preset: 'month_current',
        granularity: 'week',
      };

      const result = await controller.getCancelRate(query, {
        userId: mockUserId,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'Thống kê tỷ lệ cuộc họp bị hủy được truy xuất thành công',
      );
      expect(result.data.totalMeetingCount).toBe(10);
      expect(result.data.cancelledCount).toBe(3);
      expect(result.data.cancelRate).toBe(30.0);
      expect(result.meta).toEqual({});
      expect(mockService.getCancelRate).toHaveBeenCalledWith(
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
      mockService.getCancelRate.mockRejectedValue(forbiddenError);

      await expect(
        controller.getCancelRate({} as any, { userId: mockUserId }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('service throws unexpected error -> InternalServerErrorException', async () => {
      mockService.getCancelRate.mockRejectedValue(
        new Error('Database disconnect'),
      );

      await expect(
        controller.getCancelRate({} as any, { userId: mockUserId }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
