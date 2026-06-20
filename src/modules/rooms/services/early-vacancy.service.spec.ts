/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EarlyVacancyService } from './early-vacancy.service.js';
import { EarlyVacancyConfigService } from './early-vacancy-config.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

// UPDATE…RETURNING → [rows,count]; SELECT/INSERT → rows.
const ret = (rows: any[]) => [rows, rows.length];
const CAND = { booking_id: 'b1', meeting_id: 'm1', room_id: 'r1' };

describe('EarlyVacancyService (EVD-001 #34)', () => {
  let service: EarlyVacancyService;
  let dsMock: any;
  let qrMock: any;
  let wsMock: any;
  let notifMock: any;
  let cfg: Record<string, unknown>;

  const build = async () => {
    qrMock = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: { query: jest.fn() },
    };
    dsMock = {
      manager: { query: jest.fn() },
      createQueryRunner: jest.fn(() => qrMock),
    };
    wsMock = { emitToRoom: jest.fn() };
    notifMock = {
      createNotification: jest.fn().mockResolvedValue({}),
      enqueueEmailNotification: jest.fn().mockResolvedValue({}),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EarlyVacancyService,
        { provide: DataSource, useValue: dsMock },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
        { provide: WebsocketService, useValue: wsMock },
        { provide: NotificationsService, useValue: notifMock },
        {
          provide: EarlyVacancyConfigService,
          useValue: {
            getValues: () =>
              Promise.resolve({
                emptyMinutes: 10,
                minRemainingMinutes: 15,
                minElapsedMinutes: 10,
              }),
          },
        },
      ],
    }).compile();
    service = module.get(EarlyVacancyService);
  };

  beforeEach(async () => {
    cfg = {};
    await build();
  });

  // candidate SELECT routing (dsMock.manager.query) + flag tx (qrMock.manager.query)
  const wireDetect = (candidates: any[], over: { usageRows?: any[] } = {}) => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM room_booking_usages u'))
        return Promise.resolve(candidates);
      if (sql.includes('FROM meetings'))
        return Promise.resolve([{ organizer_id: 'u1', host_id: 'u2' }]);
      if (sql.includes('FROM users'))
        return Promise.resolve([{ email: 'a@x.com' }]);
      return Promise.resolve([]);
    });
    qrMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE room_booking_usages'))
        return Promise.resolve(ret(over.usageRows ?? [{ id: 'us1' }]));
      if (sql.includes('INSERT INTO room_events')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
  };

  it('candidate trống đủ → flag: usage early_empty + room_event + notify 1 lần', async () => {
    wireDetect([CAND]);
    const r = await service.detect();
    expect(r).toEqual({ scanned: 1, flagged: 1 });
    const sqls = qrMock.manager.query.mock.calls.map((c: any[]) => c[0]);
    expect(
      sqls.some((s: string) =>
        /UPDATE room_booking_usages[\s\S]*early_empty/.test(s),
      ),
    ).toBe(true);
    expect(sqls.some((s: string) => s.includes("'room_early_vacancy'"))).toBe(
      true,
    );
    expect(qrMock.commitTransaction).toHaveBeenCalled();
    expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
    const dto = notifMock.createNotification.mock.calls[0][0];
    expect(dto.notificationType).toBe('room_early_vacancy');
    expect(dto.recipientUserIds).toEqual(['u1', 'u2']);
  });

  it('guard in_use→early_empty: UPDATE 0 row → skip (không room_event, không notify, rollback)', async () => {
    wireDetect([CAND], { usageRows: [] });
    const r = await service.detect();
    expect(r).toEqual({ scanned: 1, flagged: 0 });
    expect(qrMock.rollbackTransaction).toHaveBeenCalled();
    expect(qrMock.commitTransaction).not.toHaveBeenCalled();
    expect(notifMock.createNotification).not.toHaveBeenCalled();
  });

  it('R-EVD-1: candidate query có điều kiện FRESH (last_any ≥ now-empty) — camera chết bị loại', async () => {
    // không có candidate trả về (camera chết → query không match) → flagged 0
    wireDetect([]);
    const r = await service.detect();
    expect(r).toEqual({ scanned: 0, flagged: 0 });
    const sql = dsMock.manager.query.mock.calls[0][0];
    // chứng minh điều kiện freshness + disjoint no-show nằm trong SQL
    expect(sql).toContain('s.last_any >= now()');
    expect(sql).toContain('s.latest_count = 0');
    expect(sql).toContain('first_presence_at IS NOT NULL'); // OQ-7 disjoint
    expect(sql).toContain("usage_status = 'in_use'"); // R-EVD-2 guard
  });

  it('recipients organizer==host → dedupe 1', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM room_booking_usages u'))
        return Promise.resolve([CAND]);
      if (sql.includes('FROM meetings'))
        return Promise.resolve([{ organizer_id: 'u1', host_id: 'u1' }]);
      return Promise.resolve([]);
    });
    qrMock.manager.query.mockImplementation((sql: string) =>
      sql.includes('UPDATE room_booking_usages')
        ? Promise.resolve(ret([{ id: 'us1' }]))
        : Promise.resolve([]),
    );
    await service.detect();
    expect(
      notifMock.createNotification.mock.calls[0][0].recipientUserIds,
    ).toEqual(['u1']);
  });

  it('email OFF (default) → KHÔNG enqueue', async () => {
    wireDetect([CAND]);
    await service.detect();
    expect(notifMock.enqueueEmailNotification).not.toHaveBeenCalled();
  });

  it('email ON → enqueue users.email', async () => {
    cfg = { EARLY_VACANCY_ALERT_EMAIL_ENABLED: true };
    wireDetect([CAND]);
    await service.detect();
    expect(notifMock.enqueueEmailNotification).toHaveBeenCalledTimes(1);
    expect(
      notifMock.enqueueEmailNotification.mock.calls[0][0].toEmails,
    ).toEqual(['a@x.com']);
  });

  it('meeting không tồn tại → notify early-return, vẫn flag', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM room_booking_usages u'))
        return Promise.resolve([CAND]);
      if (sql.includes('FROM meetings')) return Promise.resolve([]); // không có
      return Promise.resolve([]);
    });
    qrMock.manager.query.mockImplementation((sql: string) =>
      sql.includes('UPDATE room_booking_usages')
        ? Promise.resolve(ret([{ id: 'us1' }]))
        : Promise.resolve([]),
    );
    const r = await service.detect();
    expect(r.flagged).toBe(1);
    expect(notifMock.createNotification).not.toHaveBeenCalled();
  });

  it('organizer + host đều null → KHÔNG notify', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM room_booking_usages u'))
        return Promise.resolve([CAND]);
      if (sql.includes('FROM meetings'))
        return Promise.resolve([{ organizer_id: null, host_id: null }]);
      return Promise.resolve([]);
    });
    qrMock.manager.query.mockImplementation((sql: string) =>
      sql.includes('UPDATE room_booking_usages')
        ? Promise.resolve(ret([{ id: 'us1' }]))
        : Promise.resolve([]),
    );
    await service.detect();
    expect(notifMock.createNotification).not.toHaveBeenCalled();
  });

  it('email ON nhưng users không email → KHÔNG enqueue', async () => {
    cfg = { EARLY_VACANCY_ALERT_EMAIL_ENABLED: true };
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM room_booking_usages u'))
        return Promise.resolve([CAND]);
      if (sql.includes('FROM meetings'))
        return Promise.resolve([{ organizer_id: 'u1', host_id: null }]);
      if (sql.includes('FROM users')) return Promise.resolve([{ email: null }]);
      return Promise.resolve([]);
    });
    qrMock.manager.query.mockImplementation((sql: string) =>
      sql.includes('UPDATE room_booking_usages')
        ? Promise.resolve(ret([{ id: 'us1' }]))
        : Promise.resolve([]),
    );
    await service.detect();
    expect(notifMock.enqueueEmailNotification).not.toHaveBeenCalled();
  });

  it('notify lỗi (createNotification reject) → swallow, flag vẫn thành công', async () => {
    wireDetect([CAND]);
    notifMock.createNotification.mockRejectedValueOnce(new Error('notif down'));
    const r = await service.detect();
    expect(r.flagged).toBe(1); // notify best-effort, KHÔNG rollback
    expect(qrMock.commitTransaction).toHaveBeenCalled();
  });

  it('WS emit lỗi → KHÔNG fail flag (best-effort)', async () => {
    wireDetect([CAND]);
    wsMock.emitToRoom.mockImplementation(() => {
      throw new Error('ws down');
    });
    const r = await service.detect();
    expect(r.flagged).toBe(1);
    expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
  });

  it('rowsOf chuẩn hoá: [rows,count] / rows / non-array', () => {
    const rowsOf = (service as any).rowsOf.bind(service);
    expect(rowsOf([[{ id: 'a' }], 1])).toEqual([{ id: 'a' }]); // UPDATE…RETURNING
    expect(rowsOf([{ id: 'b' }])).toEqual([{ id: 'b' }]); // SELECT-shape
    expect(rowsOf(null)).toEqual([]); // non-array
  });

  it('batch resilience: 1 booking lỗi không chặn booking còn lại', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM room_booking_usages u'))
        return Promise.resolve([
          { booking_id: 'b1', meeting_id: 'm1', room_id: 'r1' },
          { booking_id: 'b2', meeting_id: 'm2', room_id: 'r2' },
        ]);
      if (sql.includes('FROM meetings'))
        return Promise.resolve([{ organizer_id: 'u1', host_id: null }]);
      return Promise.resolve([]);
    });
    let call = 0;
    qrMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE room_booking_usages')) {
        call++;
        if (call === 1) return Promise.reject(new Error('boom'));
        return Promise.resolve(ret([{ id: 'us2' }]));
      }
      if (sql.includes('INSERT INTO room_events')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const r = await service.detect();
    expect(r.scanned).toBe(2);
    expect(r.flagged).toBe(1); // b2 vẫn flag dù b1 lỗi
  });
});
