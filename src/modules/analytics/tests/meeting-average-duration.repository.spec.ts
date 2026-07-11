import { MeetingAverageDurationRepository } from '../repositories/meeting-average-duration.repository';

describe('MeetingAverageDurationRepository', () => {
  let repo: MeetingAverageDurationRepository;
  let mockQuery: jest.Mock;

  const baseParams = {
    from: '2026-06-01',
    to: '2026-06-30',
    scopeDepartmentIds: null as string[] | null,
    granularity: 'week',
  };

  beforeEach(() => {
    mockQuery = jest.fn();
    repo = new MeetingAverageDurationRepository({
      query: mockQuery,
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getManagerDepartmentIds', () => {
    it('queries departments for manager', async () => {
      mockQuery.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]);
      const result = await repo.getManagerDepartmentIds('user-1');
      expect(result).toEqual(['d1', 'd2']);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM departments'),
        ['user-1'],
      );
    });
  });

  describe('buildScopeWhere (via methods)', () => {
    it('null scopeDepartmentIds -> no organizer_id scope filter', async () => {
      mockQuery.mockResolvedValue([]);
      await repo.getAverageDurationByBucket(baseParams);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain(
        'organizer_id IN (SELECT u.id FROM users u WHERE u.department_id = ANY(',
      );
    });

    it('empty scopeDepartmentIds -> FALSE clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, scopeDepartmentIds: [] as string[] };
      await repo.getAverageDurationByBucket(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('FALSE');
    });

    it('non-empty scopeDepartmentIds -> ANY clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = {
        ...baseParams,
        scopeDepartmentIds: ['d1', 'd2'],
      };
      await repo.getAverageDurationByBucket(params);
      const values = mockQuery.mock.calls[0][1];
      expect(values).toContainEqual(['d1', 'd2']);
    });

    it('departmentIds filter -> ANY clause for departmentIds', async () => {
      mockQuery.mockResolvedValue([]);
      const params = {
        ...baseParams,
        departmentIds: ['d3', 'd4'],
      };
      await repo.getAverageDurationByBucket(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain(
        'organizer_id IN (SELECT u2.id FROM users u2 WHERE u2.department_id = ANY(',
      );
      const values = mockQuery.mock.calls[0][1];
      expect(values).toContainEqual(['d3', 'd4']);
    });

    it('roomId filter -> room_id clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, roomId: 'room-1' };
      await repo.getAverageDurationByBucket(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('room_id = ');
      const values = mockQuery.mock.calls[0][1];
      expect(values).toContain('room-1');
    });
  });

  describe('getAverageDurationByBucket', () => {
    it('returns Map of formatted result', async () => {
      mockQuery.mockResolvedValue([
        { period: '2026-W23', planned_avg: '60.5', actual_avg: '55.2', cnt: 5 },
      ]);
      const result = await repo.getAverageDurationByBucket(baseParams);
      expect(result.get('2026-W23')).toEqual({
        plannedAvg: 60.5,
        actualAvg: 55.2,
        count: 5,
      });
    });

    it('uses correct date format patterns', async () => {
      mockQuery.mockResolvedValue([]);

      await repo.getAverageDurationByBucket({
        ...baseParams,
        granularity: 'day',
      });
      expect(mockQuery.mock.calls[0][0]).toContain('YYYY-MM-DD');

      await repo.getAverageDurationByBucket({
        ...baseParams,
        granularity: 'month',
      });
      expect(mockQuery.mock.calls[1][0]).toContain('YYYY-MM');

      await repo.getAverageDurationByBucket({
        ...baseParams,
        granularity: 'quarter',
      });
      expect(mockQuery.mock.calls[2][0]).toContain('YYYY-"Q"Q');
    });

    it('implements population-sync: filters out records missing both actual and presence times', async () => {
      mockQuery.mockResolvedValue([]);
      await repo.getAverageDurationByBucket(baseParams);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('actual_end_time IS NOT NULL');
      expect(sql).toContain('actual_start_time IS NOT NULL');
      expect(sql).toContain('last_presence_at IS NOT NULL');
      expect(sql).toContain('first_presence_at IS NOT NULL');
    });
  });

  describe('getAverageDurationSummary', () => {
    it('returns summary object', async () => {
      mockQuery.mockResolvedValue([
        { planned_avg: '65.4', actual_avg: '58.9', cnt: 12 },
      ]);
      const result = await repo.getAverageDurationSummary(baseParams);
      expect(result).toEqual({
        plannedAvg: 65.4,
        actualAvg: 58.9,
        count: 12,
      });
    });

    it('handles null values for summary', async () => {
      mockQuery.mockResolvedValue([
        { planned_avg: null, actual_avg: null, cnt: 0 },
      ]);
      const result = await repo.getAverageDurationSummary(baseParams);
      expect(result).toEqual({
        plannedAvg: null,
        actualAvg: null,
        count: 0,
      });
    });

    it('implements population-sync: filters out records missing both actual and presence times', async () => {
      mockQuery.mockResolvedValue([
        { planned_avg: null, actual_avg: null, cnt: 0 },
      ]);
      await repo.getAverageDurationSummary(baseParams);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('actual_end_time IS NOT NULL');
      expect(sql).toContain('actual_start_time IS NOT NULL');
      expect(sql).toContain('last_presence_at IS NOT NULL');
      expect(sql).toContain('first_presence_at IS NOT NULL');
    });
  });
});
