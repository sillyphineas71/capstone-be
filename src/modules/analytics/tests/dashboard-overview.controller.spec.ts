import { ForbiddenException } from '@nestjs/common';
import { DashboardOverviewController } from '../controllers/dashboard-overview.controller';
import { DashboardOverviewService } from '../services/dashboard-overview.service';

describe('DashboardOverviewController', () => {
  let controller: DashboardOverviewController;
  let mockService: jest.Mocked<DashboardOverviewService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    mockService = {
      getOverview: jest.fn(),
    } as unknown as jest.Mocked<DashboardOverviewService>;

    controller = new DashboardOverviewController(mockService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getOverview', () => {
    it('valid request -> 200 with correct response shape', async () => {
      mockService.getOverview.mockResolvedValue({
        period: { from: '2026-06-01', to: '2026-06-30' },
        meetingCount: 10,
        activeRooms: 5,
        utilizationRate: 68.5,
        noShowRate: 7.2,
        onTimeRate: 85.3,
        recordingCount: 3,
        activeUserCount: 15,
        trend: [],
      });

      const query = {
        from: '2026-06-01',
        to: '2026-06-30',
      };

      const result = await controller.getOverview(query, {
        userId: mockUserId,
      });

      expect(result.success).toBe(true);
      expect(result.data.meetingCount).toBe(10);
      expect(result.data.utilizationRate).toBe(68.5);
      expect(mockService.getOverview).toHaveBeenCalledWith(
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
      mockService.getOverview.mockRejectedValue(forbiddenError);

      await expect(
        controller.getOverview({} as any, { userId: mockUserId }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('service throws unexpected error -> InternalServerErrorException', async () => {
      mockService.getOverview.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(
        controller.getOverview({} as any, { userId: mockUserId }),
      ).rejects.toThrow('Internal server error');
    });

    it('audit log called on success (non-blocking)', async () => {
      mockService.getOverview.mockResolvedValue({
        period: { from: '2026-06-01', to: '2026-06-30' },
        meetingCount: 0,
        activeRooms: 0,
        utilizationRate: 0,
        noShowRate: 0,
        onTimeRate: 0,
        recordingCount: 0,
        activeUserCount: 0,
        trend: [],
      });

      const result = await controller.getOverview(
        { from: '2026-06-01', to: '2026-06-30' },
        { userId: mockUserId },
      );

      expect(result.success).toBe(true);
    });
  });
});
