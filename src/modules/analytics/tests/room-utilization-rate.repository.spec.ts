import { RoomUtilizationRateRepository } from '../repositories/room-utilization-rate.repository';

describe('RoomUtilizationRateRepository', () => {
  let repo: RoomUtilizationRateRepository;
  let mockQuery: jest.Mock;

  beforeEach(() => {
    mockQuery = jest.fn();
    repo = new RoomUtilizationRateRepository({
      query: mockQuery,
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getManagerRoomIds', () => {
    it('queries room ids dynamically based on date range', async () => {
      mockQuery.mockResolvedValue([{ room_id: 'r1' }]);
      const result = await repo.getManagerRoomIds('user-1', '2026-06-01', '2026-06-30');
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

  describe('getActiveRoomCount', () => {
    it('queries active rooms in comparison scope', async () => {
      mockQuery.mockResolvedValue([{ cnt: 5 }]);
      const result = await repo.getActiveRoomCount(null);
      expect(result).toBe(5);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('FROM rooms WHERE');
      expect(sql).toContain('is_active = true');
    });

    it('queries active rooms filtered by scope', async () => {
      mockQuery.mockResolvedValue([{ cnt: 2 }]);
      const result = await repo.getActiveRoomCount(['r1', 'r2']);
      expect(result).toBe(2);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('id = ANY(');
    });
  });

  describe('getPeriodAggregate', () => {
    it('queries SUM of durations for approved/active/completed/released bookings', async () => {
      mockQuery
        .mockResolvedValueOnce([{ cnt: 1 }]) // activeRoomCount
        .mockResolvedValueOnce([{ booked_minutes: 120 }]) // booked minutes
        .mockResolvedValueOnce([{ actual_minutes: 90 }]); // actual minutes

      const result = await repo.getPeriodAggregate(null, 'r1', '2026-06-01', '2026-06-30');

      expect(result.bookedMinutesSum).toBe(120);
      expect(result.actualMinutesSum).toBe(90);
      expect(result.hasActualData).toBe(true);
      expect(result.activeRoomCount).toBe(1);

      const bookedSql = mockQuery.mock.calls[1][0] as string;
      expect(bookedSql).toContain('SUM(EXTRACT(EPOCH FROM (rb.reserved_end_time - rb.reserved_start_time)) / 60)');
      expect(bookedSql).toContain("rb.status IN ('approved', 'active', 'completed', 'released')");
    });
  });
});
