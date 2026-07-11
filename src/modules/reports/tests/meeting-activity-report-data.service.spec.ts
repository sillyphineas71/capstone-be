/**
 * meeting-activity-report-data.service.spec.ts
 *
 * Unit tests cho MeetingActivityReportDataService (T033, T034, T035).
 * Test: getCoreKpis, getStatusBreakdown, getMeetingDetailList.
 *
 * AC-002: getCoreKpis đối chiếu công thức UC-AA-01/08/09/10 (scope organizer)
 * AC-008: getStatusBreakdown thứ tự ưu tiên No-show > Scheduled
 * T035: getMeetingDetailList — participationRate = (present+late)/totalInvited
 *
 * NOTE: getCoreKpis dùng Promise.all nên 4 sub-queries chạy song song.
 * Mock phải dùng SQL-content-based dispatch thay vì sequential mockResolvedValueOnce.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { MeetingActivityReportDataService } from '../services/meeting-activity-report-data.service.js';

/** Helper: create SQL dispatch mock. Each entry: [partialSQL, returnValue] */
function makeSqlDispatchMock(
  rules: Array<[string, unknown]>,
  defaultValue: unknown = [{ count: '0', hours: '0' }],
) {
  return jest.fn().mockImplementation(async (sql: string) => {
    for (const [pattern, value] of rules) {
      if (sql.includes(pattern)) return value;
    }
    return defaultValue;
  });
}

describe('MeetingActivityReportDataService', () => {
  let service: MeetingActivityReportDataService;

  const mockDataSource = { query: jest.fn() };
  const mockConfigService = { get: jest.fn().mockReturnValue(8) };

  const baseParams = {
    from: '2026-07-01',
    to: '2026-07-31',
    scope: { departmentId: null, roomId: null, organizerId: null },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingActivityReportDataService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MeetingActivityReportDataService>(
      MeetingActivityReportDataService,
    );
  });

  // ─── T033: getCoreKpis ────────────────────────────────────────────────────────

  describe('T033 — getCoreKpis (AC-002)', () => {
    it('returns correct meetingCount from DB (UC-AA-01 formula)', async () => {
      // getCoreKpis runs 4 sub-functions in Promise.all (parallel)
      // Use SQL-content dispatch to handle non-deterministic call order
      mockDataSource.query = makeSqlDispatchMock([
        ["status <> 'draft'", [{ count: '42' }]], // meetingCount
        ['COUNT(DISTINCT r.id)', [{ count: '5' }]], // rooms for utilization
        ['EPOCH', [{ hours: '120' }]], // bookedHours
        ['analytics.room_operating_hours_per_day', [{ config_value: '8' }]], // operating hrs
        ["'approved', 'active', 'completed', 'released'", [{ count: '50' }]], // totalBookings no-show
        ['no_show_cases', [{ count: '5' }]], // noShowCount
        ['check_in_time <=', [{ count: '80' }]], // onTimeCount
        ['meeting_participants', [{ count: '100' }]], // totalRequired on-time
      ]);

      const kpis = await service.getCoreKpis(baseParams);
      expect(kpis.meetingCount).toBe(42);
    });

    it('returns 0 for all KPIs when no data', async () => {
      mockDataSource.query.mockResolvedValue([{ count: '0', hours: '0' }]);

      const kpis = await service.getCoreKpis(baseParams);
      expect(kpis.meetingCount).toBe(0);
      expect(kpis.reservationUtilizationRate).toBe(0);
      expect(kpis.noShowRate).toBe(0);
      expect(kpis.onTimeRate).toBe(0);
    });

    it('T033 — noShowRate: only counts confirmed/released no_show_cases (UC-AA-09)', async () => {
      mockDataSource.query = makeSqlDispatchMock([
        ["status <> 'draft'", [{ count: '0' }]],
        ['COUNT(DISTINCT r.id)', [{ count: '1' }]],
        ['EPOCH', [{ hours: '0' }]],
        ['analytics.room_operating_hours_per_day', []],
        // totalBookings (all room_bookings): 10
        ["'approved', 'active', 'completed', 'released'", [{ count: '10' }]],
        // noShowCount: 2 (only confirmed/released)
        ['no_show_cases', [{ count: '2' }]],
        ['meeting_participants', [{ count: '0' }]],
        ['check_in_time <=', [{ count: '0' }]],
      ]);

      const kpis = await service.getCoreKpis(baseParams);
      // noShowRate = 2/10 * 100 = 20%
      expect(kpis.noShowRate).toBe(20);
    });

    it('T033 — onTimeRate uses organizer scope (NOT attendee scope)', async () => {
      const scopedParams = {
        ...baseParams,
        scope: { departmentId: 'dept-A', roomId: null, organizerId: null },
      };

      mockDataSource.query = makeSqlDispatchMock([
        ["status <> 'draft'", [{ count: '5' }]],
        ['COUNT(DISTINCT r.id)', [{ count: '1' }]],
        ['EPOCH', [{ hours: '10' }]],
        ['analytics.room_operating_hours_per_day', []],
        ["'approved', 'active', 'completed', 'released'", [{ count: '5' }]],
        ['no_show_cases', [{ count: '0' }]],
        ['check_in_time <=', [{ count: '8' }]], // onTimeCount
        ['meeting_participants', [{ count: '10' }]], // totalRequired
      ]);

      const kpis = await service.getCoreKpis(scopedParams);
      // onTimeRate = 8/10 * 100 = 80%
      expect(kpis.onTimeRate).toBe(80);

      // Verify no attendee-scope filtering (no mp.department_id in any query)
      const calls = mockDataSource.query.mock.calls;
      calls.forEach(([sql]: [string]) => {
        expect(sql).not.toContain('mp.department_id');
      });
    });

    it('T033 — getCoreKpis handles reservationUtilizationRate with room scope correctly (Low #10)', async () => {
      const roomScopedParams = {
        ...baseParams,
        scope: { departmentId: null, roomId: 'room-123', organizerId: null },
      };

      mockDataSource.query = makeSqlDispatchMock([
        ["status <> 'draft'", [{ count: '10' }]],
        ['COUNT(DISTINCT r.id)', [{ count: '1' }]], // activeRoomCount
        ['EPOCH', [{ hours: '40' }]], // bookedHours
        ['analytics.room_operating_hours_per_day', [{ config_value: '8' }]],
        ["'approved', 'active', 'completed', 'released'", [{ count: '10' }]],
        ['no_show_cases', [{ count: '1' }]],
        ['meeting_participants', [{ count: '10' }]],
        ['check_in_time <=', [{ count: '10' }]],
      ]);

      const kpis = await service.getCoreKpis(roomScopedParams);
      // activeRoomCount = 1, operatingHours = 8, numberOfDays = 31
      // totalCapacityHours = 8 * 31 * 1 = 248
      // bookedHours = 40
      // rate = 40 / 248 = 16.129% -> 16.13%
      expect(kpis.reservationUtilizationRate).toBeCloseTo(16.13, 2);

      const calls = mockDataSource.query.mock.calls;
      const rRateQuery = calls.find(
        ([sql]: [string]) => sql.includes('SUM') && sql.includes('EPOCH'),
      );
      expect(rRateQuery).toBeDefined();
      expect(rRateQuery![0]).toContain('rb.room_id = $3');
    });
  });

  // ─── T034: getStatusBreakdown ────────────────────────────────────────────────

  describe('T034 — getStatusBreakdown (AC-008)', () => {
    it('classifies meeting with no_show_cases as No-show, not Scheduled', async () => {
      // Returns are ordered: cancelled → no-show → completed → scheduled
      // getStatusBreakdown makes 4 sequential queries (not parallel)
      mockDataSource.query
        .mockResolvedValueOnce([{ count: '0' }]) // cancelled
        .mockResolvedValueOnce([{ count: '1' }]) // no-show (has confirmed no_show_case)
        .mockResolvedValueOnce([{ count: '3' }]) // completed (no no-show)
        .mockResolvedValueOnce([{ count: '2' }]); // scheduled (no no-show)

      const breakdown = await service.getStatusBreakdown(baseParams);

      expect(breakdown).toHaveLength(4);
      const noShowItem = breakdown.find((b) => b.status === 'No-show');
      const scheduledItem = breakdown.find((b) => b.status === 'Scheduled');

      // noShow = 1 (meeting with no_show_case), scheduled = 2 (pure scheduled)
      expect(noShowItem?.count).toBe(1);
      expect(scheduledItem?.count).toBe(2);

      // Total = 0+1+3+2 = 6
      expect(noShowItem?.percentage).toBeCloseTo((1 / 6) * 100, 1);
    });

    it('returns 4 status groups always (even with 0 counts)', async () => {
      mockDataSource.query.mockResolvedValue([{ count: '0' }]);

      const breakdown = await service.getStatusBreakdown(baseParams);
      expect(breakdown).toHaveLength(4);
      const statuses = breakdown.map((b) => b.status);
      expect(statuses).toContain('Cancelled');
      expect(statuses).toContain('No-show');
      expect(statuses).toContain('Completed');
      expect(statuses).toContain('Scheduled');
    });
  });

  // ─── T035: getMeetingDetailList ──────────────────────────────────────────────

  describe('T035 — getMeetingDetailList', () => {
    it('calculates participationRate as (present+late)/totalInvited, NOT on-time-rate', async () => {
      // 5 invited, 3 present (including 1 late) → participationRate = 3/5 = 60%
      mockDataSource.query.mockResolvedValueOnce([
        {
          meeting_code: 'MTG-001',
          title: 'Test Meeting',
          organizer_email: 'org@test.com',
          room_name: 'Room A',
          start_time: new Date('2026-07-15T09:00:00Z'),
          end_time: new Date('2026-07-15T10:00:00Z'),
          status: 'completed',
          total_invited: '5',
          present_count: '3', // attendance_status IN ('present','late')
        },
      ]);

      const details = await service.getMeetingDetailList(baseParams);
      expect(details).toHaveLength(1);
      expect(details[0].participationRate).toBeCloseTo(60, 1); // 3/5 * 100
    });

    it('does NOT limit number of rows returned', async () => {
      // Simulate 200 meetings
      const manyMeetings = Array.from({ length: 200 }, (_, i) => ({
        meeting_code: `MTG-${i}`,
        title: `Meeting ${i}`,
        organizer_email: 'org@test.com',
        room_name: 'Room A',
        start_time: new Date('2026-07-01T09:00:00Z'),
        end_time: new Date('2026-07-01T10:00:00Z'),
        status: 'completed',
        total_invited: '4',
        present_count: '4',
      }));

      mockDataSource.query.mockResolvedValueOnce(manyMeetings);

      const details = await service.getMeetingDetailList(baseParams);
      expect(details).toHaveLength(200); // no artificial limit
    });

    it('returns participationRate=0 when no participants', async () => {
      mockDataSource.query.mockResolvedValueOnce([
        {
          meeting_code: 'MTG-002',
          title: 'Empty Meeting',
          organizer_email: null,
          room_name: null,
          start_time: new Date('2026-07-15T09:00:00Z'),
          end_time: null,
          status: 'completed',
          total_invited: '0',
          present_count: '0',
        },
      ]);

      const details = await service.getMeetingDetailList(baseParams);
      expect(details[0].participationRate).toBe(0);
    });
  });

  // ─── getReportMetadata ───────────────────────────────────────────────────────

  describe('getReportMetadata', () => {
    it('returns fixed label when no departmentId', async () => {
      const meta = await service.getReportMetadata(baseParams, 'user@test.com');
      expect(meta.organizationLabel).toBe('Toàn tổ chức');
      expect(meta.extractedByEmail).toBe('user@test.com');
    });

    it('returns department_name when departmentId provided', async () => {
      mockDataSource.query.mockResolvedValueOnce([
        { department_name: 'Engineering' },
      ]);

      const meta = await service.getReportMetadata(
        {
          ...baseParams,
          scope: { departmentId: 'dept-1', roomId: null, organizerId: null },
        },
        'user@test.com',
      );
      expect(meta.organizationLabel).toBe('Engineering');
    });
  });
});
