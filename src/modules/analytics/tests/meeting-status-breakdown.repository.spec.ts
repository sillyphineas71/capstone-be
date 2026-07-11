import { MeetingStatusBreakdownRepository } from '../repositories/meeting-status-breakdown.repository';

describe('MeetingStatusBreakdownRepository', () => {
  let repo: MeetingStatusBreakdownRepository;
  let mockQuery: jest.Mock;

  const baseParams = {
    from: '2026-06-01',
    to: '2026-06-30',
    scopeDepartmentIds: null as string[] | null,
  };

  beforeEach(() => {
    mockQuery = jest.fn();
    repo = new MeetingStatusBreakdownRepository({
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

  describe('buildScopeWhere (via methods)', () => {
    it('null scopeDepartmentIds -> no organizer_id scope filter', async () => {
      mockQuery.mockResolvedValue([]);
      await repo.getStatusCounts(baseParams);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain(
        'organizer_id IN (SELECT u.id FROM users u WHERE u.department_id = ANY(',
      );
    });

    it('empty scopeDepartmentIds -> FALSE clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, scopeDepartmentIds: [] as string[] };
      await repo.getStatusCounts(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('FALSE');
    });

    it('non-empty scopeDepartmentIds -> ANY clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = {
        ...baseParams,
        scopeDepartmentIds: ['d1', 'd2'],
      };
      await repo.getStatusCounts(params);
      const values = mockQuery.mock.calls[0][1];
      expect(values).toContainEqual(['d1', 'd2']);
    });

    it('departmentIds filter -> ANY clause for departmentIds', async () => {
      mockQuery.mockResolvedValue([]);
      const params = {
        ...baseParams,
        departmentIds: ['d3', 'd4'],
      };
      await repo.getStatusCounts(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain(
        'organizer_id IN (SELECT u2.id FROM users u2 WHERE u2.department_id = ANY(',
      );
    });
  });

  describe('getStatusCounts', () => {
    it('returns counts map grouped by classified status and has case precedence', async () => {
      mockQuery.mockResolvedValue([
        { classified_status: 'completed', cnt: 5 },
        { classified_status: 'scheduled', cnt: 10 },
      ]);
      const result = await repo.getStatusCounts(baseParams);
      expect(result.get('completed')).toBe(5);
      expect(result.get('scheduled')).toBe(10);
      expect(result.get('cancelled')).toBe(0);
      expect(result.get('no_show')).toBe(0);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('WITH classified_meetings AS');
      expect(sql).toContain("m.status = 'cancelled' THEN 'cancelled'");
      expect(sql).toContain("detection_status IN ('confirmed', 'released')");
      expect(sql).toContain('LEFT JOIN room_bookings rb');
      expect(sql).toContain('LEFT JOIN no_show_cases nsc');
    });

    it('verifies SQL CASE classification precedence order', async () => {
      mockQuery.mockResolvedValue([]);
      await repo.getStatusCounts(baseParams);
      const sql = mockQuery.mock.calls[0][0] as string;

      const caseStartIndex = sql.indexOf('CASE');
      const caseEndIndex = sql.indexOf('END AS classified_status');
      expect(caseStartIndex).toBeGreaterThan(-1);
      expect(caseEndIndex).toBeGreaterThan(-1);
      const caseSql = sql.substring(caseStartIndex, caseEndIndex);

      // precedence order: cancelled -> no_show -> completed -> scheduled
      const cancelledIndex = caseSql.indexOf(
        "m.status = 'cancelled' THEN 'cancelled'",
      );
      const noShowIndex = caseSql.indexOf(
        "detection_status IN ('confirmed', 'released')",
      );
      const completedIndex = caseSql.indexOf(
        "m.status = 'completed' THEN 'completed'",
      );
      const scheduledIndex = caseSql.indexOf(
        "m.status = 'scheduled' THEN 'scheduled'",
      );

      expect(cancelledIndex).toBeGreaterThan(-1);
      expect(noShowIndex).toBeGreaterThan(cancelledIndex);
      expect(completedIndex).toBeGreaterThan(noShowIndex);
      expect(scheduledIndex).toBeGreaterThan(completedIndex);

      // Check detection status does not include 'risk'
      expect(caseSql).toContain(
        "nsc.detection_status IN ('confirmed', 'released')",
      );
    });

    it('maps query rows to Map including all statuses even if not present in SQL result', async () => {
      mockQuery.mockResolvedValue([
        { classified_status: 'cancelled', cnt: 2 },
        { classified_status: 'no_show', cnt: 4 },
      ]);
      const result = await repo.getStatusCounts(baseParams);
      expect(result.get('cancelled')).toBe(2);
      expect(result.get('no_show')).toBe(4);
      expect(result.get('completed')).toBe(0);
      expect(result.get('scheduled')).toBe(0);
    });
  });
});
