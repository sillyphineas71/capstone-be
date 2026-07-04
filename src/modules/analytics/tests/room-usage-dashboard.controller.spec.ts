import { ForbiddenException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { RoomUsageDashboardController } from '../controllers/room-usage-dashboard.controller';
import { RoomUsageDashboardService } from '../services/room-usage-dashboard.service';

describe('RoomUsageDashboardController', () => {
  let controller: RoomUsageDashboardController;
  let mockService: jest.Mocked<RoomUsageDashboardService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';
  const mockRoomId = '00000000-0000-0000-0000-000000000002';

  beforeEach(() => {
    mockService = {
      getComparisonDashboard: jest.fn(),
      getRoomDetail: jest.fn(),
    } as unknown as jest.Mocked<RoomUsageDashboardService>;

    controller = new RoomUsageDashboardController(mockService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getComparison', () => {
    it('valid request -> 200 with dashboard response', async () => {
      const mockResult = {
        data: {
          period: { from: '2026-06-01', to: '2026-06-30' },
          summary: {
            reservationUtilizationRate: 5.0,
            roomOccupancyRate: 75.0,
            totalBookedHours: 2.0,
            actualUsedHours: 1.5,
          },
          rooms: [],
          trend: [],
        },
        message: 'Thống kê sử dụng phòng họp được truy xuất thành công',
      };

      mockService.getComparisonDashboard.mockResolvedValue(mockResult);

      const query = {
        preset: 'month',
      };

      const result = await controller.getComparison(query as any, {
        userId: mockUserId,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Thống kê sử dụng phòng họp được truy xuất thành công');
      expect(result.data.summary.reservationUtilizationRate).toBe(5.0);
      expect(result.meta).toEqual({});
      expect(mockService.getComparisonDashboard).toHaveBeenCalledWith(
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
      mockService.getComparisonDashboard.mockRejectedValue(forbiddenError);

      await expect(
        controller.getComparison({} as any, { userId: mockUserId }),
      ).rejects.toThrow(ForbiddenException);
    });

    // T4c: Verifies that when service throws 403 PERMISSION_DENIED (e.g. EMPLOYEE role),
    // the controller propagates the ForbiddenException correctly
    it('T4c – service signals PERMISSION_DENIED (e.g. EMPLOYEE role) -> controller re-throws ForbiddenException', async () => {
      const permissionDenied = new ForbiddenException({
        success: false,
        message: 'You do not have permission to view room usage analytics',
        error: { code: 'PERMISSION_DENIED', details: {} },
      });
      mockService.getComparisonDashboard.mockRejectedValue(permissionDenied);

      await expect(
        controller.getComparison({} as any, { userId: mockUserId }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('service throws unexpected error -> InternalServerErrorException', async () => {
      mockService.getComparisonDashboard.mockRejectedValue(new Error('DB Error'));

      await expect(
        controller.getComparison({} as any, { userId: mockUserId }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getDetail', () => {
    it('valid request -> 200 with room detail response', async () => {
      const mockResult = {
        data: {
          room: { roomId: mockRoomId, roomName: 'Room A' },
          period: { from: '2026-06-01', to: '2026-06-30' },
          bookedHours: 2.0,
          actualHours: 1.5,
          reservationUtilizationRate: 5.0,
          roomOccupancyRate: 75.0,
          hasActualData: true,
          heatmap: [],
          meetings: [],
        },
        message: 'Thông tin chi tiết phòng họp được truy xuất thành công',
      };

      mockService.getRoomDetail.mockResolvedValue(mockResult);

      const query = {
        preset: 'month',
      };

      const result = await controller.getDetail(mockRoomId, query as any, {
        userId: mockUserId,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Thông tin chi tiết phòng họp được truy xuất thành công');
      expect(result.data.room.roomName).toBe('Room A');
      expect(mockService.getRoomDetail).toHaveBeenCalledWith(
        { userId: mockUserId },
        mockRoomId,
        query,
      );
    });

    it('service throws NotFoundException -> re-thrown as-is', async () => {
      mockService.getRoomDetail.mockRejectedValue(new NotFoundException({ success: false, message: 'Room not found' }));

      await expect(
        controller.getDetail(mockRoomId, {} as any, { userId: mockUserId }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
