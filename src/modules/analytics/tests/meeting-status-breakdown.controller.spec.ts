import {
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { MeetingStatusBreakdownController } from '../controllers/meeting-status-breakdown.controller';
import { MeetingStatusBreakdownService } from '../services/meeting-status-breakdown.service';

describe('MeetingStatusBreakdownController', () => {
  let controller: MeetingStatusBreakdownController;
  let mockService: jest.Mocked<MeetingStatusBreakdownService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    mockService = {
      getStatusBreakdown: jest.fn(),
    } as unknown as jest.Mocked<MeetingStatusBreakdownService>;

    controller = new MeetingStatusBreakdownController(mockService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getStatusBreakdown', () => {
    it('valid request -> 200 with correct response shape', async () => {
      const mockResult = {
        data: {
          period: { from: '2026-06-01', to: '2026-06-30' },
          total: 10,
          items: [
            {
              status: 'scheduled' as const,
              count: 10,
              percentage: 100.0,
            },
          ],
        },
        message: 'Thống kê cuộc họp theo trạng thái được truy xuất thành công',
      };

      mockService.getStatusBreakdown.mockResolvedValue(mockResult);

      const query = {
        preset: 'month',
      };

      const result = await controller.getStatusBreakdown(query, {
        userId: mockUserId,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'Thống kê cuộc họp theo trạng thái được truy xuất thành công',
      );
      expect(result.data.total).toBe(10);
      expect(result.data.items[0]).toEqual({
        status: 'scheduled',
        count: 10,
        percentage: 100.0,
      });
      expect(result.meta).toEqual({});
      expect(mockService.getStatusBreakdown).toHaveBeenCalledWith(
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
      mockService.getStatusBreakdown.mockRejectedValue(forbiddenError);

      await expect(
        controller.getStatusBreakdown({} as any, { userId: mockUserId }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('service throws unexpected error -> InternalServerErrorException', async () => {
      mockService.getStatusBreakdown.mockRejectedValue(
        new Error('Database disconnect'),
      );

      await expect(
        controller.getStatusBreakdown({} as any, { userId: mockUserId }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
