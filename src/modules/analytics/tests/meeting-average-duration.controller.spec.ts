import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { MeetingAverageDurationController } from '../controllers/meeting-average-duration.controller';
import { MeetingAverageDurationService } from '../services/meeting-average-duration.service';

describe('MeetingAverageDurationController', () => {
  let controller: MeetingAverageDurationController;
  let mockService: jest.Mocked<MeetingAverageDurationService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    mockService = {
      getAverageDuration: jest.fn(),
    } as unknown as jest.Mocked<MeetingAverageDurationService>;

    controller = new MeetingAverageDurationController(mockService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getAverageDuration', () => {
    it('valid request -> 200 with correct response shape', async () => {
      const mockResult = {
        data: {
          period: { from: '2026-06-01', to: '2026-06-30' },
          summary: {
            plannedAverageMinutes: 65.0,
            actualAverageMinutes: 58.2,
            completedMeetingCount: 98,
          },
          series: [
            {
              period: '2026-W18',
              plannedAverageMinutes: 68.0,
              actualAverageMinutes: 60.5,
              completedMeetingCount: 32,
            },
          ],
        },
        message: 'Thống kê thời lượng trung bình cuộc họp được truy xuất thành công',
      };

      mockService.getAverageDuration.mockResolvedValue(mockResult);

      const query = {
        from: '2026-06-01',
        to: '2026-06-30',
        granularity: 'week',
      };

      const result = await controller.getAverageDuration(query as any, {
        userId: mockUserId,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Thống kê thời lượng trung bình cuộc họp được truy xuất thành công');
      expect(result.data.summary.plannedAverageMinutes).toBe(65.0);
      expect(result.data.summary.actualAverageMinutes).toBe(58.2);
      expect(result.meta).toEqual({});
      expect(result.data.series[0].period).toBe('2026-W18');
      expect(mockService.getAverageDuration).toHaveBeenCalledWith(
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
      mockService.getAverageDuration.mockRejectedValue(forbiddenError);

      await expect(
        controller.getAverageDuration({} as any, { userId: mockUserId }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('service throws unexpected error -> InternalServerErrorException', async () => {
      mockService.getAverageDuration.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        controller.getAverageDuration({} as any, { userId: mockUserId }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
