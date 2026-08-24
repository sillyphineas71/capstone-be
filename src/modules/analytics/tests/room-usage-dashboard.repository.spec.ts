import { RoomUsageDashboardRepository } from '../repositories/room-usage-dashboard.repository';

describe('RoomUsageDashboardRepository', () => {
  let repo: RoomUsageDashboardRepository;
  let mockQuery: jest.Mock;

  const baseParams = {
    from: '2026-06-01',
    to: '2026-06-30',
    scopeRoomIds: null as string[] | null,
  };

  beforeEach(() => {
    mockQuery = jest.fn();
    repo = new RoomUsageDashboardRepository({
      query: mockQuery,
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getManagerRoomIds', () => {
    it('queries room ids dynamically based on date range', async () => {
      mockQuery.mockResolvedValue([{ room_id: 'r1' }]);
      const result = await repo.getManagerRoomIds(
        'user-1',
        '2026-06-01',
        '2026-06-30',
      );
      expect(result).toEqual(['r1']);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT DISTINCT rb.room_id'),
        ['user-1', '2026-06-01', '2026-06-30'],
      );
    });
  });

  describe('getRoom', () => {
    it('queries room details', async () => {
      mockQuery.mockResolvedValue([{ id: 'r1', roomName: 'Room A' }]);
      const result = await repo.getRoom('r1');
      expect(result).toEqual({ id: 'r1', roomName: 'Room A' });
    });
  });

  describe('buildScopeWhere (via methods)', () => {
    it('null scopeRoomIds -> no room_id scope filter', async () => {
      mockQuery.mockResolvedValue([]);
      await repo.getBookedAggregate(baseParams);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain('rb.room_id = ANY(');
    });

    it('empty scopeRoomIds -> FALSE clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, scopeRoomIds: [] as string[] };
      await repo.getBookedAggregate(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('FALSE');
    });

    it('scopeRoomIds filter -> room_id ANY clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, scopeRoomIds: ['r1'] };
      await repo.getBookedAggregate(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('rb.room_id = ANY(');
    });

    it('roomId filter -> room_id clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, roomId: 'r1' };
      await repo.getBookedAggregate(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('rb.room_id = ');
    });

    it('siteName filter -> site_name clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, siteName: 'Site A' };
      await repo.getBookedAggregate(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('r.site_name = ');
    });
  });

  describe('getBookedAggregate', () => {
    it('queries SUM of durations for approved/active/completed/released bookings', async () => {
      mockQuery.mockResolvedValue([{ room_id: 'r1', booked_minutes: 120 }]);
      const result = await repo.getBookedAggregate(baseParams);
      expect(result.get('r1')).toBe(120);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain(
        'SUM(EXTRACT(EPOCH FROM (rb.reserved_end_time - rb.reserved_start_time)) / 60)',
      );
      expect(sql).toContain(
        "rb.status IN ('approved', 'active', 'completed', 'released')",
      );
    });
  });

  describe('getActualAggregate', () => {
    it('queries SUM of actual/presence durations from room_booking_usages', async () => {
      mockQuery.mockResolvedValue([{ room_id: 'r1', actual_minutes: 90 }]);
      const result = await repo.getActualAggregate(baseParams);
      expect(result.get('r1')).toEqual({
        actualMinutes: 90,
        hasActualData: true,
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      // L2: We now use CASE WHEN to enforce complete atomic pairs (not COALESCE which could cross-mix actual vs presence)
      expect(sql).toContain('CASE');
      expect(sql).toContain(
        'WHEN rbu.actual_start_time IS NOT NULL AND rbu.actual_end_time IS NOT NULL',
      );
      // Thời lượng thực tế bị kẹp (clamp) vào đúng khung giờ đã đặt, để một bản
      // ghi usage lỗi (kết thúc sau nhiều ngày) không đẩy tỷ lệ lấp đầy vượt 100%.
      expect(sql).toContain(
        'LEAST(rbu.actual_end_time, rbu.reserved_end_time)',
      );
      expect(sql).toContain(
        'GREATEST(rbu.actual_start_time, rbu.reserved_start_time)',
      );
      expect(sql).toContain(
        'LEAST(rbu.last_presence_at, rbu.reserved_end_time)',
      );
      expect(sql).toContain(
        'GREATEST(rbu.first_presence_at, rbu.reserved_start_time)',
      );
      expect(sql).toContain('rbu.actual_start_time IS NOT NULL');
    });
  });

  describe('listRoomsForComparison', () => {
    it('queries active rooms in comparison scope', async () => {
      mockQuery.mockResolvedValue([{ id: 'r1', room_name: 'Room 1' }]);
      const result = await repo.listRoomsForComparison(baseParams);
      expect(result).toHaveLength(1);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('FROM rooms r');
      expect(sql).toContain('r.is_active = true');
    });
  });

  describe('getRoomMeetingsList', () => {
    it('queries meetings of a room in the date range', async () => {
      mockQuery.mockResolvedValue([]);
      await repo.getRoomMeetingsList('r1', '2026-06-01', '2026-06-30');
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT');
      expect(sql).toContain('rb.room_id = $1');
    });
  });

  describe('getRoomTrend', () => {
    it('queries daily trend meetings count', async () => {
      mockQuery.mockResolvedValue([]);
      await repo.getRoomTrend('2026-06-01', '2026-06-30', null);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('COUNT(DISTINCT m.id)');
    });
  });

  describe('getRoomUsagesRaw', () => {
    it('queries raw usage records for heatmap computation', async () => {
      mockQuery.mockResolvedValue([]);
      await repo.getRoomUsagesRaw('r1', '2026-06-01', '2026-06-30');
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain(
        'THEN GREATEST(rbu.actual_start_time, rbu.reserved_start_time) END AS "actualStartTime"',
      );
    });
  });
});
