import { MeetingCancelRateRepository } from '../repositories/meeting-cancel-rate.repository';

describe('MeetingCancelRateRepository', () => {
  let repo: MeetingCancelRateRepository;
  let mockQuery: jest.Mock;

  const baseParams = {
    from: '2026-06-01',
    to: '2026-06-30',
    scopeDepartmentIds: null as string[] | null,
    granularity: 'week',
  };

  beforeEach(() => {
    mockQuery = jest.fn();
    repo = new MeetingCancelRateRepository({
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

  describe('findUserIdByEmail', () => {
    it('queries user by lower cased email', async () => {
      mockQuery.mockResolvedValue([{ id: 'u1' }]);
      const result = await repo.findUserIdByEmail('TEST@company.com');
      expect(result).toBe('u1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          'SELECT id FROM users WHERE LOWER(email) = LOWER(',
        ),
        ['TEST@company.com'],
      );
    });
  });

  describe('buildScopeWhere (via methods)', () => {
    it('null scopeDepartmentIds -> no organizer_id scope filter', async () => {
      mockQuery.mockResolvedValue([]);
      await repo.getCancelRateSummary(baseParams);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain(
        'organizer_id IN (SELECT u.id FROM users u WHERE u.department_id = ANY(',
      );
    });

    it('empty scopeDepartmentIds -> FALSE clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, scopeDepartmentIds: [] as string[] };
      await repo.getCancelRateSummary(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('FALSE');
    });

    it('non-empty scopeDepartmentIds -> ANY clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = {
        ...baseParams,
        scopeDepartmentIds: ['d1', 'd2'],
      };
      await repo.getCancelRateSummary(params);
      const values = mockQuery.mock.calls[0][1];
      expect(values).toContainEqual(['d1', 'd2']);
    });

    it('departmentIds filter -> ANY clause for departmentIds', async () => {
      mockQuery.mockResolvedValue([]);
      const params = {
        ...baseParams,
        departmentIds: ['d3', 'd4'],
      };
      await repo.getCancelRateSummary(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain(
        'organizer_id IN (SELECT u2.id FROM users u2 WHERE u2.department_id = ANY(',
      );
    });

    it('roomId filter -> room_id clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, roomId: 'room-1' };
      await repo.getCancelRateSummary(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('room_id = ');
    });

    it('organizerId filter -> organizer_id clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, organizerId: 'user-1' };
      await repo.getCancelRateSummary(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('organizer_id = ');
    });
  });

  describe('getCancelRateSummary', () => {
    it('returns summary results', async () => {
      mockQuery.mockResolvedValue([{ total_count: 10, cancelled_count: 3 }]);
      const result = await repo.getCancelRateSummary(baseParams);
      expect(result).toEqual({ totalMeetingCount: 10, cancelledCount: 3 });
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("status <> 'draft'");
      expect(sql).toContain('deleted_at IS NULL');
    });
  });

  describe('getCancelRateSeries', () => {
    it('returns series map grouped by period', async () => {
      mockQuery.mockResolvedValue([
        { period: '2026-W23', total_count: 5, cancelled_count: 1 },
      ]);
      const result = await repo.getCancelRateSeries(baseParams);
      expect(result.get('2026-W23')).toEqual({
        totalCount: 5,
        cancelledCount: 1,
      });
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('GROUP BY period');
    });

    it('uses correct format patterns', async () => {
      mockQuery.mockResolvedValue([]);

      await repo.getCancelRateSeries({ ...baseParams, granularity: 'week' });
      expect(mockQuery.mock.calls[0][0]).toContain('IYYY-"W"IW');

      await repo.getCancelRateSeries({ ...baseParams, granularity: 'month' });
      expect(mockQuery.mock.calls[1][0]).toContain('YYYY-MM');
    });
  });

  describe('getTopOrganizers', () => {
    it('returns top 10 organizers', async () => {
      mockQuery.mockResolvedValue([
        {
          user_id: 'u1',
          email: 'o1@co.com',
          full_name: 'Org 1',
          organized_count: 5,
          cancelled_count: 3,
        },
      ]);
      const result = await repo.getTopOrganizers(baseParams);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        userId: 'u1',
        email: 'o1@co.com',
        fullName: 'Org 1',
        organizedCount: 5,
        cancelledCount: 3,
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('HAVING COUNT(*) >= 3');
      expect(sql).toContain('ORDER BY cancelled_count DESC');
      expect(sql).toContain('LIMIT 10');
    });
  });

  describe('getTopDepartments', () => {
    it('returns top 10 departments', async () => {
      mockQuery.mockResolvedValue([
        {
          department_id: 'd1',
          department_name: 'Dept 1',
          organized_count: 6,
          cancelled_count: 4,
        },
      ]);
      const result = await repo.getTopDepartments(baseParams);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        departmentId: 'd1',
        departmentName: 'Dept 1',
        organizedCount: 6,
        cancelledCount: 4,
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('INNER JOIN departments d');
      expect(sql).toContain('HAVING COUNT(*) >= 3');
      expect(sql).toContain('ORDER BY cancelled_count DESC');
      expect(sql).toContain('LIMIT 10');
    });
  });
});
