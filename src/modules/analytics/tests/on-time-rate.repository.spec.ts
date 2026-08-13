import { OnTimeRateRepository } from '../repositories/on-time-rate.repository';

describe('OnTimeRateRepository', () => {
  let repo: OnTimeRateRepository;
  let mockQuery: jest.Mock;

  const baseParams = {
    from: '2026-06-01',
    to: '2026-06-30',
    scopeDepartmentIds: null as string[] | null,
    graceMinutes: 0,
  };

  beforeEach(() => {
    mockQuery = jest.fn();
    repo = new OnTimeRateRepository({
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

  describe('getUserDetails', () => {
    it('queries user details', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 'u1',
          fullName: 'User 1',
          email: 'u1@co.com',
          departmentId: 'd1',
        },
      ]);
      const result = await repo.getUserDetails('user-1');
      expect(result).toEqual({
        id: 'u1',
        fullName: 'User 1',
        email: 'u1@co.com',
        departmentId: 'd1',
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, full_name'),
        ['user-1'],
      );
    });

    it('returns null if not found', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await repo.getUserDetails('user-1');
      expect(result).toBeNull();
    });
  });

  describe('buildScopeWhere (via methods)', () => {
    it('null scopeDepartmentIds -> no u.department_id scope filter', async () => {
      mockQuery.mockResolvedValue([]);
      await repo.getKpiTotals(baseParams);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain('u.department_id = ANY(');
    });

    it('empty scopeDepartmentIds -> FALSE clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, scopeDepartmentIds: [] as string[] };
      await repo.getKpiTotals(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('FALSE');
    });

    it('scopeDepartmentIds filter -> u.department_id ANY clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, scopeDepartmentIds: ['d1'] };
      await repo.getKpiTotals(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('u.department_id = ANY(');
      // Verify scope DOES NOT filter by meetings.organizer_id!
      expect(sql).not.toContain('organizer_id');
    });

    it('departmentId filter -> u.department_id clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, departmentId: 'd1' };
      await repo.getKpiTotals(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('u.department_id = ');
    });

    it('meetingId filter -> m.id clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, meetingId: 'm1' };
      await repo.getKpiTotals(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('m.id = ');
    });

    it('search filter -> ILIKE clauses', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, search: 'Jack' };
      await repo.getKpiTotals(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('u.full_name ILIKE ');
      expect(sql).toContain('u.email ILIKE ');
    });
  });

  describe('getKpiTotals', () => {
    it('queries totals using CASE classification containing absent fallback and invalidated exclusion', async () => {
      mockQuery.mockResolvedValue([
        { on_time_count: 50, late_count: 10, absent_count: 5, total_count: 65 },
      ]);
      const result = await repo.getKpiTotals(baseParams);
      expect(result).toEqual({
        onTimeCount: 50,
        lateCount: 10,
        absentCount: 5,
        totalRequiredParticipants: 65,
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('WITH classified AS');
      expect(sql).toContain("m.status = 'completed'");
      expect(sql).toContain("mp.invitation_status <> 'declined'");
      expect(sql).toContain(
        "ar.attendance_status NOT IN ('invalidated', 'pending_review')",
      );
      expect(sql).toContain(
        "CASE WHEN NOT ar.is_late THEN 'on_time' ELSE 'late' END",
      );
      expect(sql).toContain('ar.late_minutes <=');
    });
  });

  describe('getTrendByWeek', () => {
    it('queries trend grouped by week', async () => {
      mockQuery.mockResolvedValue([
        {
          week_key: '2026-06-01',
          on_time_count: 10,
          late_count: 2,
          absent_count: 1,
          total_count: 13,
        },
      ]);
      const result = await repo.getTrendByWeek(baseParams);
      expect(result.get('2026-06-01')).toEqual({
        onTimeCount: 10,
        lateCount: 2,
        absentCount: 1,
        totalRequiredParticipants: 13,
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain(
        "date_trunc('week', m.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')",
      );
      expect(sql).toContain('GROUP BY week_start');
    });
  });

  describe('getLateByHourOfDay', () => {
    it('queries distribution grouped by hour', async () => {
      mockQuery.mockResolvedValue([
        { hour_of_day: 9, late_count: 2, total_count: 15 },
      ]);
      const result = await repo.getLateByHourOfDay(baseParams);
      expect(result.get(9)).toEqual({
        lateCount: 2,
        totalRequiredParticipants: 15,
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain(
        "EXTRACT(HOUR FROM m.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')",
      );
      expect(sql).toContain('GROUP BY hour_of_day');
    });
  });

  describe('getLateByDepartment', () => {
    it('queries breakdown joined with departments, kèm on_time_count riêng (FIX 2026-08-13)', async () => {
      mockQuery.mockResolvedValue([
        {
          department_id: 'd1',
          department_name: 'Dept 1',
          late_count: 5,
          on_time_count: 20,
          total_count: 30,
        },
      ]);
      const result = await repo.getLateByDepartment(baseParams);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        departmentId: 'd1',
        departmentName: 'Dept 1',
        lateCount: 5,
        onTimeCount: 20,
        totalRequiredParticipants: 30,
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain(
        'INNER JOIN departments d ON d.id = c.department_id',
      );
      expect(sql).toContain('GROUP BY d.id, d.department_name');
      expect(sql).toContain(
        "COUNT(*) FILTER (WHERE c.status_bucket = 'on_time')::int AS on_time_count",
      );
    });
  });

  describe('getUserProfileForStats', () => {
    it('queries user profile joined with department name', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 'u1',
          fullName: 'Nguyen Van A',
          email: 'a@co.com',
          employeeCode: 'EMP001',
          avatarUrl: null,
          departmentId: 'd1',
          departmentName: 'Phong IT',
        },
      ]);
      const result = await repo.getUserProfileForStats('u1');
      expect(result).toEqual({
        id: 'u1',
        fullName: 'Nguyen Van A',
        email: 'a@co.com',
        employeeCode: 'EMP001',
        avatarUrl: null,
        departmentId: 'd1',
        departmentName: 'Phong IT',
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LEFT JOIN departments d ON d.id = u.department_id'),
        ['u1'],
      );
    });

    it('returns null if user not found', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await repo.getUserProfileForStats('missing');
      expect(result).toBeNull();
    });
  });

  describe('getPersonalKpiTotals', () => {
    it('lọc theo mp.user_id, KHÔNG dùng is_required/attendance_required', async () => {
      mockQuery.mockResolvedValue([
        { on_time_count: 8, late_count: 2, absent_count: 0, total_count: 10 },
      ]);
      const result = await repo.getPersonalKpiTotals(
        'u1',
        '2026-06-01',
        '2026-06-30',
        5,
      );
      expect(result).toEqual({
        onTimeCount: 8,
        lateCount: 2,
        absentCount: 0,
        totalRequiredParticipants: 10,
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('mp.user_id = $1');
      expect(sql).toContain("mp.invitation_status <> 'declined'");
      expect(sql).not.toContain('is_required');
      expect(sql).not.toContain('attendance_required');
      expect(mockQuery).toHaveBeenCalledWith(sql, ['u1', 5, '2026-06-01', '2026-06-30']);
    });
  });

  describe('getPersonalTrendByWeek', () => {
    it('queries per-user weekly trend grouped by week', async () => {
      mockQuery.mockResolvedValue([
        {
          week_key: '2026-06-01',
          on_time_count: 3,
          late_count: 1,
          absent_count: 0,
          total_count: 4,
        },
      ]);
      const result = await repo.getPersonalTrendByWeek(
        'u1',
        '2026-06-01',
        '2026-06-30',
        5,
      );
      expect(result.get('2026-06-01')).toEqual({
        onTimeCount: 3,
        lateCount: 1,
        absentCount: 0,
        totalRequiredParticipants: 4,
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('mp.user_id = $1');
      expect(sql).toContain('GROUP BY week_start');
    });
  });

  describe('getLateHistory', () => {
    it('queries user late records sorting by start_time DESC', async () => {
      mockQuery.mockResolvedValue([
        {
          meetingId: 'm1',
          meetingTitle: 'M1',
          scheduledStartTime: new Date(),
          checkInTime: new Date(),
          lateMinutes: 10,
        },
      ]);
      const result = await repo.getLateHistory(
        'user-1',
        '2026-06-01',
        '2026-06-30',
        5,
      );
      expect(result).toHaveLength(1);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('ar.late_minutes > $4');
      expect(sql).toContain('ORDER BY m.start_time DESC');
    });
  });

  describe('checkDepartmentExists', () => {
    it('returns true when department exists and is active', async () => {
      mockQuery.mockResolvedValue([{ '?column?': 1 }]);
      const result = await repo.checkDepartmentExists('d1');
      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          'SELECT 1 FROM departments WHERE id = $1 AND is_active = true',
        ),
        ['d1'],
      );
    });

    it('returns false when department does not exist', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await repo.checkDepartmentExists('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getLateByUsers', () => {
    it('queries user late stats with pagination and sorting', async () => {
      mockQuery.mockResolvedValue([
        {
          userId: 'u1',
          fullName: 'Nguyen Van A',
          email: 'a@co.com',
          avatarUrl: 'http://avatar.jpg',
          employeeCode: 'EMP001',
          departmentId: 'd1',
          departmentName: 'Phong IT',
          lateCount: 5,
          onTimeCount: 15,
          absentCount: 2,
          totalRequired: 22,
          lateRate: 22.7,
          totalCount: 1,
        },
      ]);

      const result = await repo.getLateByUsers(baseParams, 'lateRate', 1, 10);
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        userId: 'u1',
        fullName: 'Nguyen Van A',
        email: 'a@co.com',
        avatarUrl: 'http://avatar.jpg',
        employeeCode: 'EMP001',
        departmentId: 'd1',
        departmentName: 'Phong IT',
        lateCount: 5,
        onTimeCount: 15,
        absentCount: 2,
        totalRequired: 22,
        lateRate: 22.7,
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('WITH classified AS');
      expect(sql).toContain('aggregated AS');
      expect(sql).toContain('ORDER BY late_rate DESC, full_name ASC');
      expect(sql).toContain('LIMIT $4 OFFSET $5');
    });

    it('returns empty when scope is empty (FALSE clause)', async () => {
      const params = { ...baseParams, scopeDepartmentIds: [] as string[] };
      const result = await repo.getLateByUsers(params, 'lateRate', 1, 10);
      expect(result).toEqual({ items: [], total: 0 });
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
