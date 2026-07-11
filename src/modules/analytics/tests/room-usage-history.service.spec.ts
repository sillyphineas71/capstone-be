import { Test, TestingModule } from '@nestjs/testing';
import { RoomUsageHistoryService } from '../services/room-usage-history.service.js';
import { RoomUsageDashboardService } from '../services/room-usage-dashboard.service.js';
import { RoomUsageHistoryConfigService } from '../services/room-usage-history-config.service.js';
import { RoomUsageConfigService } from '../services/room-usage-config.service.js';
import {
  RoomUsageHistoryRepository,
  RawSessionRow,
} from '../repositories/room-usage-history.repository.js';

describe('RoomUsageHistoryService', () => {
  let service: RoomUsageHistoryService;

  const mockDashboardService = {
    resolveDateRange: jest.fn(),
    validateMaxRange: jest.fn(),
    resolveScope: jest.fn(),
  };
  const mockHistoryConfigService = {
    getLateCancellationThresholdMinutes: jest.fn(),
  };
  const mockRoomUsageConfigService = { getOperatingHoursPerDay: jest.fn() };
  const mockRepo = {
    getSessionsPage: jest.fn(),
    getSessionsCount: jest.fn(),
    getSummaryAggregate: jest.fn(),
    getActiveRoomCount: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDashboardService.resolveDateRange.mockReturnValue({
      from: '2026-07-01',
      to: '2026-07-31',
    });
    mockDashboardService.validateMaxRange.mockResolvedValue(undefined);
    mockDashboardService.resolveScope.mockResolvedValue({
      isAdmin: true,
      scopeRoomIds: null,
    });
    mockHistoryConfigService.getLateCancellationThresholdMinutes.mockResolvedValue(
      60,
    );
    mockRoomUsageConfigService.getOperatingHoursPerDay.mockResolvedValue(8);
    mockRepo.getSessionsPage.mockResolvedValue([]);
    mockRepo.getSessionsCount.mockResolvedValue(0);
    mockRepo.getSummaryAggregate.mockResolvedValue({
      totalReservedHours: 0,
      totalActualHours: null,
      noShowCount: 0,
    });
    mockRepo.getActiveRoomCount.mockResolvedValue(5);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomUsageHistoryService,
        { provide: RoomUsageDashboardService, useValue: mockDashboardService },
        {
          provide: RoomUsageHistoryConfigService,
          useValue: mockHistoryConfigService,
        },
        {
          provide: RoomUsageConfigService,
          useValue: mockRoomUsageConfigService,
        },
        { provide: RoomUsageHistoryRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get<RoomUsageHistoryService>(RoomUsageHistoryService);
  });

  const baseRow: RawSessionRow = {
    room_id: 'r1',
    room_name: 'Phòng 101',
    meeting_id: 'm1',
    meeting_title: 'Họp giao ban',
    host_name: 'Nguyễn Văn A',
    reserved_start_time: new Date('2026-07-10T09:00:00Z'),
    reserved_end_time: new Date('2026-07-10T10:00:00Z'),
    actual_start_time: null,
    actual_end_time: null,
    booking_status: 'approved',
    booking_updated_at: new Date('2026-07-01T00:00:00Z'),
    usage_status: null,
  };

  describe('deriveSessionStatus (FR-DATA-002)', () => {
    it('maps usage_status=completed to sessionStatus=completed', () => {
      const row = { ...baseRow, usage_status: 'completed' };
      expect(service.deriveSessionStatus(row, 60, new Date())).toBe(
        'completed',
      );
    });

    it('maps usage_status=no_show to sessionStatus=no_show', () => {
      const row = { ...baseRow, usage_status: 'no_show' };
      expect(service.deriveSessionStatus(row, 60, new Date())).toBe('no_show');
    });

    it('AC-003: classifies a cancellation within the threshold as cancelled_late', () => {
      // Cancelled 20 minutes before reservedStartTime, threshold = 60 minutes
      const row = {
        ...baseRow,
        booking_status: 'cancelled',
        reserved_start_time: new Date('2026-07-10T10:00:00Z'),
        booking_updated_at: new Date('2026-07-10T09:40:00Z'),
      };
      expect(service.deriveSessionStatus(row, 60, new Date())).toBe(
        'cancelled_late',
      );
    });

    it('classifies a cancellation outside the threshold as cancelled (not late)', () => {
      const row = {
        ...baseRow,
        booking_status: 'cancelled',
        reserved_start_time: new Date('2026-07-10T10:00:00Z'),
        booking_updated_at: new Date('2026-07-08T10:00:00Z'), // 2 days before
      };
      expect(service.deriveSessionStatus(row, 60, new Date())).toBe(
        'cancelled',
      );
    });

    it('CL-2: returns pending_evaluation for a past booking with no usage record yet', () => {
      const row = {
        ...baseRow,
        booking_status: 'approved',
        usage_status: null,
        reserved_end_time: new Date('2020-01-01T00:00:00Z'), // far in the past
      };
      expect(
        service.deriveSessionStatus(row, 60, new Date('2026-07-10T00:00:00Z')),
      ).toBe('pending_evaluation');
    });

    it('returns not_started for a future booking with no usage record', () => {
      const row = {
        ...baseRow,
        booking_status: 'approved',
        usage_status: null,
        reserved_end_time: new Date('2030-01-01T00:00:00Z'),
      };
      expect(
        service.deriveSessionStatus(row, 60, new Date('2026-07-10T00:00:00Z')),
      ).toBe('not_started');
    });
  });

  describe('AC-008/AC-009: empty scope or empty result', () => {
    it('returns empty sessions with the E1 message when there is no data in range', async () => {
      const { data, message, total } = await service.getUsageHistory(
        { userId: 'u1' },
        {},
      );
      expect(data.sessions).toEqual([]);
      expect(total).toBe(0);
      expect(message).toContain(
        'Không có dữ liệu sử dụng phòng họp nào được ghi nhận',
      );
    });

    it('does not throw when MANAGER has no rooms in scope (scopeRoomIds = [])', async () => {
      mockDashboardService.resolveScope.mockResolvedValue({
        isAdmin: false,
        scopeRoomIds: [],
      });
      await expect(
        service.getUsageHistory({ userId: 'u1' }, {}),
      ).resolves.toBeDefined();
    });
  });

  describe('AC-001: happy path defaults', () => {
    it('applies default page/limit/sort when not provided', async () => {
      await service.getUsageHistory({ userId: 'u1' }, {});
      expect(mockRepo.getSessionsPage).toHaveBeenCalledWith(
        expect.anything(),
        'reservedStartTime',
        'desc',
        1,
        20,
      );
    });
  });
});
