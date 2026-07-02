/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { IvssPresenceQueryService } from './ivss-presence-query.service.js';

const T = (hhmm: string) => `2026-06-23T${hhmm}:00.000Z`;
const MIN = 60 * 1000;
const GAP_MS = 120 * 1000; // default 120s

const ev = (hhmm: string, direction: string) => ({
  event_time: T(hhmm),
  direction,
  similarity: null,
  sz_uid: 'SZ1',
});

describe('IvssPresenceQueryService (IPD-001 #41+#42)', () => {
  let service: IvssPresenceQueryService;
  let dsMock: any;

  const wire = (
    o: {
      events?: any[];
      status?: string;
      unmatchedLocation?: number;
      unmatchedIdentity?: number;
      gap?: number;
      participants?: any[];
      noMeeting?: boolean;
    } = {},
  ) => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM meetings WHERE id'))
        return Promise.resolve(
          o.noMeeting
            ? []
            : [
                {
                  start_time: T('09:00'),
                  end_time: T('10:00'),
                  status: o.status ?? 'completed',
                },
              ],
        );
      if (sql.includes('config_value FROM system_configs'))
        return Promise.resolve(
          o.gap != null ? [{ config_value: String(o.gap) }] : [],
        );
      if (sql.includes("'matched'")) return Promise.resolve(o.events ?? []);
      if (sql.includes("'unmatched_location'"))
        return Promise.resolve([{ n: o.unmatchedLocation ?? 0 }]);
      if (sql.includes("'unmatched_identity'"))
        return Promise.resolve([{ n: o.unmatchedIdentity ?? 0 }]);
      if (sql.includes('meeting_participants'))
        return Promise.resolve(o.participants ?? []);
      return Promise.resolve([]);
    });
  };

  beforeEach(async () => {
    dsMock = { manager: { query: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssPresenceQueryService,
        { provide: DataSource, useValue: dsMock },
      ],
    }).compile();
    service = module.get(IvssPresenceQueryService);
  });

  const dur = async () => (await service.getUserPresence('m1', 'u1'))!;

  it('enter/leave sạch → 2 segment interval, duration = Σ', async () => {
    wire({
      events: [
        ev('09:00', 'enter'),
        ev('09:10', 'leave'),
        ev('09:20', 'enter'),
        ev('09:30', 'leave'),
      ],
    });
    const r = await dur();
    expect(r.duration.method).toBe('interval');
    expect(r.duration.segmentCount).toBe(2);
    expect(r.duration.durationMs).toBe(20 * MIN);
  });

  it('chỉ-seen (gap≤th) → 1 cluster, method approx', async () => {
    wire({
      events: [ev('09:00', 'seen'), ev('09:01', 'seen'), ev('09:02', 'seen')],
    });
    const r = await dur();
    expect(r.duration.method).toBe('approx');
    expect(r.duration.segmentCount).toBe(1);
    expect(r.duration.durationMs).toBe(2 * MIN);
  });

  it('gap>threshold giữa seen → 2 cluster (mỗi cluster 1-điểm +gap, C5)', async () => {
    wire({ events: [ev('09:00', 'seen'), ev('09:05', 'seen')] });
    const r = await dur();
    expect(r.duration.segmentCount).toBe(2);
    expect(r.duration.durationMs).toBe(2 * GAP_MS); // C5: mỗi điểm +gap
    expect(r.duration.method).toBe('approx');
  });

  it('B1 enter-enter → đóng enter cũ tại min(t, openEnter+gap), KHÔNG kéo tới enter mới', async () => {
    wire({ events: [ev('09:00', 'enter'), ev('09:30', 'enter')] });
    const r = await dur();
    // seg1 [09:00, 09:02] (gap), seg2 hở [09:30, 09:32] → 2*gap, KHÔNG phải 30min.
    expect(r.duration.durationMs).toBe(2 * GAP_MS);
    expect(r.duration.method).toBe('approx');
  });

  it('B2 leave-only → ném vào cluster, duration > 0 (giữ bằng chứng)', async () => {
    wire({ events: [ev('09:10', 'leave')] });
    const r = await dur();
    expect(r.duration.durationMs).toBe(GAP_MS); // C5 1-điểm
    expect(r.duration.method).toBe('approx');
  });

  it('OQ-3 hở (enter không leave, ended) → đóng lastActivity+gap', async () => {
    wire({ events: [ev('09:00', 'enter')], status: 'completed' });
    const r = await dur();
    expect(r.duration.durationMs).toBe(GAP_MS); // [09:00, 09:02]
  });

  it('OQ-3 hở (in_progress, window quá khứ) → nhánh min(now,end)=end, đóng lastActivity+gap', async () => {
    // window 2020 < now → endOrNow = min(now, end) = end → close min(end, 09:00+gap) = 09:02.
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM meetings WHERE id'))
        return Promise.resolve([
          {
            start_time: '2020-01-01T09:00:00.000Z',
            end_time: '2020-01-01T10:00:00.000Z',
            status: 'in_progress',
          },
        ]);
      if (sql.includes("'matched'"))
        return Promise.resolve([
          {
            event_time: '2020-01-01T09:00:00.000Z',
            direction: 'enter',
            similarity: null,
            sz_uid: 'SZ1',
          },
        ]);
      if (sql.includes('unmatched')) return Promise.resolve([{ n: 0 }]);
      return Promise.resolve([]);
    });
    const r = (await service.getUserPresence('m1', 'u1'))!;
    expect(r.duration.durationMs).toBe(GAP_MS);
  });

  it('B3 segment thò bound → clip vào [start,end]', async () => {
    wire({ events: [ev('08:50', 'enter'), ev('10:30', 'leave')] });
    const r = await dur();
    // [08:50,10:30] clip → [09:00,10:00] = 60min.
    expect(r.duration.durationMs).toBe(60 * MIN);
    expect(r.duration.presentRatio).toBe(1);
  });

  it('C1 trùng (event_time,direction) → duration KHÔNG đổi', async () => {
    wire({
      events: [
        ev('09:00', 'enter'),
        ev('09:00', 'enter'), // dup
        ev('09:10', 'leave'),
        ev('09:10', 'leave'), // dup
      ],
    });
    const r = await dur();
    expect(r.duration.durationMs).toBe(10 * MIN);
    expect(r.duration.segmentCount).toBe(1);
  });

  it('0-event → duration 0, segments rỗng, approx', async () => {
    wire({ events: [] });
    const r = await dur();
    expect(r.duration.durationMs).toBe(0);
    expect(r.duration.segmentCount).toBe(0);
    expect(r.duration.method).toBe('approx');
  });

  it('C5 cluster 1-điểm (1 seen) → KHÔNG ra 0 (kéo +gap)', async () => {
    wire({ events: [ev('09:00', 'seen')] });
    const r = await dur();
    expect(r.duration.durationMs).toBe(GAP_MS);
  });

  it('C4 unmatchedCount per-user = chỉ unmatched_location', async () => {
    wire({
      events: [ev('09:00', 'enter'), ev('09:10', 'leave')],
      unmatchedLocation: 3,
    });
    const r = await dur();
    expect(r.timeline.unmatchedCount).toBe(3);
  });

  it('OQ-7 presentRatio clamp ≤ 1', async () => {
    wire({ events: [ev('09:00', 'enter'), ev('09:30', 'leave')] });
    const r = await dur();
    expect(r.duration.presentRatio).toBeCloseTo((30 * MIN) / (60 * MIN), 5);
    expect(r.duration.presentRatio).toBeLessThanOrEqual(1);
  });

  it('SEC-01: eventLog metadata-only (KHÔNG ảnh)', async () => {
    wire({ events: [ev('09:00', 'enter')] });
    const r = await dur();
    const log = JSON.stringify(r.timeline.events);
    expect(log).not.toContain('imageBase64');
    expect(log).not.toContain('base64');
    expect(r.timeline.events[0]).toHaveProperty('direction');
  });

  it('absentGaps = complement trong bound', async () => {
    wire({ events: [ev('09:10', 'enter'), ev('09:20', 'leave')] });
    const r = await dur();
    // present [09:10,09:20] → absent [09:00,09:10] + [09:20,10:00].
    expect(r.timeline.absentGaps.length).toBe(2);
    expect(r.timeline.absentGaps[0].start).toBe(T('09:00'));
    expect(r.timeline.absentGaps[0].end).toBe(T('09:10'));
  });

  it('gap-threshold từ system_configs (override default)', async () => {
    wire({ events: [ev('09:00', 'seen')], gap: 300 }); // 300s
    const r = await dur();
    expect(r.duration.durationMs).toBe(300 * 1000); // C5 dùng gap=300s
  });

  it('meeting không tồn tại → null', async () => {
    wire({ noMeeting: true });
    expect(await service.getUserPresence('m1', 'u1')).toBeNull();
  });

  // ── per-meeting summary ──
  it('getMeetingPresence: summary mỗi participant có method (C2) + identity count (C4)', async () => {
    wire({
      events: [ev('09:00', 'enter'), ev('09:10', 'leave')],
      participants: [
        { user_id: 'u1', full_name: 'Alice' },
        { user_id: 'u2', full_name: 'Bob' },
      ],
      unmatchedIdentity: 7,
    });
    const r = (await service.getMeetingPresence('m1'))!;
    expect(r.participants.length).toBe(2);
    expect(r.participants[0]).toHaveProperty('method'); // C2
    expect(r.participants[0].fullName).toBe('Alice');
    expect(r.meetingUnmatchedIdentityCount).toBe(7); // C4
  });

  it('getMeetingPresence: meeting không tồn tại → null', async () => {
    wire({ noMeeting: true });
    expect(await service.getMeetingPresence('m1')).toBeNull();
  });
});
