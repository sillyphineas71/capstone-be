import { NoShowRateRepository } from '../repositories/no-show-rate.repository';

describe('NoShowRateRepository', () => {
  let repo: NoShowRateRepository;
  let mockQuery: jest.Mock;

  const baseParams = {
    from: '2026-06-01',
    to: '2026-06-30',
    scopeDepartmentIds: null as string[] | null,
    scopeRoomIds: null as string[] | null,
  };

  beforeEach(() => {
    mockQuery = jest.fn();
    repo = new NoShowRateRepository({
      query: mockQuery,
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getManagerDepartmentIds', () => {
    it('queries departments for manager', async () => {
      mockQuery.mockResolvedValue([{ id: 'd1' }]);
      const result = await repo.getManagerDepartmentIds('user-1');
      expect(result).toEqual(['d1']);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM departments'),
        ['user-1'],
      );
    });
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

  describe('findUserIdByEmail', () => {
    it('queries user id', async () => {
      mockQuery.mockResolvedValue([{ id: 'u1' }]);
      const result = await repo.findUserIdByEmail('TEST@co.com');
      expect(result).toBe('u1');
    });
  });

  describe('buildScopeWhere (via methods)', () => {
    it('null scopeDepartmentIds -> no organizer_id scope filter', async () => {
      mockQuery.mockResolvedValue([]);
      await repo.getKpiAggregate(baseParams);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain(
        'organizer_id IN (SELECT u.id FROM users u WHERE u.department_id = ANY(',
      );
    });

    it('empty scopeDepartmentIds -> FALSE clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, scopeDepartmentIds: [] as string[] };
      await repo.getKpiAggregate(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('FALSE');
    });

    it('scopeRoomIds filter -> room_id ANY clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, scopeRoomIds: ['r1'] };
      await repo.getKpiAggregate(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('room_id = ANY(');
    });

    it('departmentIds filter -> ANY clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, departmentIds: ['d1'] };
      await repo.getKpiAggregate(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain(
        'organizer_id IN (SELECT u2.id FROM users u2 WHERE u2.department_id = ANY(',
      );
    });

    it('roomId filter -> room_id clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, roomId: 'r1' };
      await repo.getKpiAggregate(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('room_id = ');
    });

    it('organizerId filter -> organizer_id clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, organizerId: 'u1' };
      await repo.getKpiAggregate(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('organizer_id = ');
    });
  });

  describe('getKpiAggregate', () => {
    it('queries totals and counts of confirmed/released cases', async () => {
      mockQuery.mockResolvedValue([{ totalBookings: 15, noShowCount: 3 }]);
      const result = await repo.getKpiAggregate(baseParams);
      expect(result).toEqual({ totalBookings: 15, noShowCount: 3 });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain(
        "status IN ('approved', 'active', 'completed', 'released')",
      );
      expect(sql).toContain("detection_status IN ('confirmed', 'released')");
      expect(sql).not.toContain("'risk'");
    });
  });

  describe('getRoomRanking', () => {
    it('queries room ranking sorting by noShowCount DESC', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 'r1',
          name: 'Room 1',
          totalBookings: 5,
          noShowCount: 3,
          fullCount: 1,
        },
      ]);
      const result = await repo.getRoomRanking(baseParams, 1, 10);
      expect(result).toHaveLength(1);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('INNER JOIN rooms r ON r.id = rb.room_id');
      expect(sql).toContain('ORDER BY "noShowCount" DESC');
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
    });
  });

  describe('getDepartmentRanking', () => {
    it('queries department ranking sorting by noShowRate DESC', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 'd1',
          name: 'Dept 1',
          totalBookings: 5,
          noShowCount: 3,
          fullCount: 1,
        },
      ]);
      const result = await repo.getDepartmentRanking(baseParams, 1, 10);
      expect(result).toHaveLength(1);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain(
        'INNER JOIN departments d ON d.id = u.department_id',
      );
      // Department sorts by rate DESC, then count DESC
      expect(sql).toContain(
        "ORDER BY (COUNT(DISTINCT nsc.id) FILTER (WHERE nsc.detection_status IN ('confirmed', 'released'))::double precision / NULLIF(COUNT(DISTINCT rb.id), 0)) DESC, \"noShowCount\" DESC",
      );
    });
  });

  describe('getOrganizerRanking', () => {
    it('queries organizer ranking sorting by noShowCount DESC', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 'u1',
          name: 'User 1',
          email: 'u1@co.com',
          totalBookings: 5,
          noShowCount: 3,
          fullCount: 1,
        },
      ]);
      const result = await repo.getOrganizerRanking(baseParams, 1, 10);
      expect(result).toHaveLength(1);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('ORDER BY "noShowCount" DESC');
    });
  });
});
