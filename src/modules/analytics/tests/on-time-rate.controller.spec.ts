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
      getOnTimeRateByUsers: jest.fn(),
      getPersonalStats: jest.fn(),
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

  describe('getOnTimeRateByUsers', () => {
    it('valid request -> 200 with user stats response shape', async () => {
      const mockResult = {
        data: {
          items: [
            {
              userId: mockTargetId,
              fullName: 'User A',
              email: 'a@co.com',
              avatarUrl: null,
              employeeCode: 'EMP001',
              departmentId: 'd1',
              departmentName: 'Dept 1',
              lateCount: 2,
              onTimeCount: 8,
              absentCount: 0,
              totalRequired: 10,
              lateRate: 20.0,
            },
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
          period: { from: '2026-06-01', to: '2026-06-30' },
          graceMinutes: 0,
        },
        message:
          'Thống kê tỷ lệ tham dự đúng giờ theo nhân sự được truy xuất thành công',
      };

      mockService.getOnTimeRateByUsers.mockResolvedValue(mockResult);

      const query = { preset: 'month', page: 1, limit: 10 };
      const result = await controller.getOnTimeRateByUsers(query, {
        userId: mockUserId,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'Thống kê tỷ lệ tham dự đúng giờ theo nhân sự được truy xuất thành công',
      );
      expect(result.data.items).toHaveLength(1);
      expect(result.data.total).toBe(1);
      // FE đọc phân trang ở res.meta — controller mirror từ data (13/08/2026).
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(mockService.getOnTimeRateByUsers).toHaveBeenCalledWith(
        { userId: mockUserId },
        query,
      );
    });

    it('service throws ForbiddenException -> re-thrown as-is', async () => {
      mockService.getOnTimeRateByUsers.mockRejectedValue(
        new ForbiddenException({
          success: false,
          message: 'Department is outside your scope',
        }),
      );

      await expect(
        controller.getOnTimeRateByUsers({} as any, { userId: mockUserId }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('service throws NotFoundException -> re-thrown as-is', async () => {
      mockService.getOnTimeRateByUsers.mockRejectedValue(
        new NotFoundException({
          success: false,
          message: 'Department not found',
        }),
      );

      await expect(
        controller.getOnTimeRateByUsers({} as any, { userId: mockUserId }),
      ).rejects.toThrow(NotFoundException);
    });

    it('service throws unexpected error -> InternalServerErrorException', async () => {
      mockService.getOnTimeRateByUsers.mockRejectedValue(
        new Error('DB failure'),
      );

      await expect(
        controller.getOnTimeRateByUsers({} as any, { userId: mockUserId }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getPersonalStats (GET /analytics/attendance/on-time-rate/me)', () => {
    it('valid request -> 200, currentUser.userId truyền thẳng xuống service, không nhận userId từ query', async () => {
      const mockResult = {
        data: {
          userId: mockUserId,
          fullName: 'Nguyen Van A',
          email: 'a@co.com',
          employeeCode: 'EMP001',
          departmentName: 'Phong IT',
          avatarUrl: null,
          period: { from: '2026-06-01', to: '2026-06-30' },
          graceMinutes: 5,
          summary: {
            totalRequired: 10,
            onTimeCount: 8,
            lateCount: 2,
            absentCount: 0,
            onTimeRate: 80.0,
            lateRate: 20.0,
          },
          departmentAvg: {
            departmentId: 'd1',
            departmentName: 'Phong IT',
            onTimeRate: 70.0,
          },
          trend: [],
          recentLate: [],
        },
        message: 'Thống kê chuyên cần cá nhân được truy xuất thành công',
      };
      mockService.getPersonalStats.mockResolvedValue(mockResult);

      // Query cố tình chèn userId lạ để xác nhận controller/service bỏ qua nó hoàn toàn.
      const query = { preset: 'month', userId: 'someone-else' } as any;
      const result = await controller.getPersonalStats(query, {
        userId: mockUserId,
      });

      expect(result.success).toBe(true);
      expect(result.data.userId).toBe(mockUserId);
      expect(mockService.getPersonalStats).toHaveBeenCalledWith(
        { userId: mockUserId },
        query,
      );
    });

    it('service throws NotFoundException -> re-thrown as-is', async () => {
      mockService.getPersonalStats.mockRejectedValue(
        new NotFoundException({ success: false, message: 'User not found' }),
      );

      await expect(
        controller.getPersonalStats({} as any, { userId: mockUserId }),
      ).rejects.toThrow(NotFoundException);
    });

    it('service throws unexpected error -> InternalServerErrorException', async () => {
      mockService.getPersonalStats.mockRejectedValue(new Error('DB failure'));

      await expect(
        controller.getPersonalStats({} as any, { userId: mockUserId }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
