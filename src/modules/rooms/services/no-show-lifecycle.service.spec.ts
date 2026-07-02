/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { NoShowLifecycleService } from './no-show-lifecycle.service.js';
import { NoShowConfigService } from './no-show-config.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';

// Shape helpers: UPDATE…RETURNING → [rows,count]; SELECT/INSERT → rows.
const ret = (rows: any[]) => [rows, rows.length];

describe('NoShowLifecycleService (NSL-001)', () => {
  let service: NoShowLifecycleService;
  let dsMock: any;
  let qrMock: any;
  let wsMock: any;
  let notifMock: any;
  let auditMock: any;
  let configValues: any;
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
    auditMock = { logAction: jest.fn().mockResolvedValue(undefined) };
    configValues = {
      thresholdMinutes: 15,
      warningGraceMinutes: 0,
      autoReleaseGraceMinutes: 5,
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoShowLifecycleService,
        { provide: DataSource, useValue: dsMock },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
        { provide: WebsocketService, useValue: wsMock },
        { provide: NotificationsService, useValue: notifMock },
        {
          provide: NoShowConfigService,
          useValue: { getValues: () => Promise.resolve(configValues) },
        },
        { provide: AuditLogsService, useValue: auditMock },
      ],
    }).compile();
    service = module.get(NoShowLifecycleService);
  };

  beforeEach(async () => {
    cfg = {};
    await build();
  });

  // ── R1 reconcilePresence ──
  it('reconcilePresence: case có presence → resolved (count từ RETURNING)', async () => {
    dsMock.manager.query.mockResolvedValueOnce(
      ret([{ id: 'c1' }, { id: 'c2' }]),
    );
    const r = await service.reconcilePresence();
    expect(r).toEqual({ scanned: 2, resolved: 2 });
    const sql = dsMock.manager.query.mock.calls[0][0];
    expect(sql).toContain("resolution_status = 'kept'");
    expect(sql).toContain('first_presence_at IS NOT NULL');
  });

  // ── #32 warnBatch ──
  const meetingRow = [{ organizer_id: 'u1', host_id: 'u2' }];

  it('warnBatch: risk đủ điều kiện → warning_sent + notify in-app 1 lần', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM no_show_cases nc') && sql.includes("'risk'"))
        return Promise.resolve([
          { id: 'c1', booking_id: 'b1', meeting_id: 'm1', room_id: 'r1' },
        ]);
      if (sql.includes('UPDATE no_show_cases'))
        return Promise.resolve(ret([{ id: 'c1' }]));
      if (sql.includes('FROM meetings')) return Promise.resolve(meetingRow);
      return Promise.resolve([]);
    });
    const r = await service.warnBatch();
    expect(r).toEqual({ scanned: 1, warned: 1 });
    expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
    const dto = notifMock.createNotification.mock.calls[0][0];
    expect(dto.notificationType).toBe('no_show_alert');
    expect(dto.recipientScope).toBe('user_list');
    expect(dto.recipientUserIds).toEqual(['u1', 'u2']);
  });

  it('warnBatch idempotent: UPDATE 0 row → KHÔNG notify', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM no_show_cases nc') && sql.includes("'risk'"))
        return Promise.resolve([
          { id: 'c1', booking_id: 'b1', meeting_id: 'm1', room_id: 'r1' },
        ]);
      if (sql.includes('UPDATE no_show_cases')) return Promise.resolve(ret([]));
      return Promise.resolve([]);
    });
    const r = await service.warnBatch();
    expect(r.warned).toBe(0);
    expect(notifMock.createNotification).not.toHaveBeenCalled();
  });

  it('warnBatch: organizer==host → dedupe 1 recipient', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM no_show_cases nc') && sql.includes("'risk'"))
        return Promise.resolve([
          { id: 'c1', booking_id: 'b1', meeting_id: 'm1', room_id: 'r1' },
        ]);
      if (sql.includes('UPDATE no_show_cases'))
        return Promise.resolve(ret([{ id: 'c1' }]));
      if (sql.includes('FROM meetings'))
        return Promise.resolve([{ organizer_id: 'u1', host_id: 'u1' }]);
      return Promise.resolve([]);
    });
    await service.warnBatch();
    expect(
      notifMock.createNotification.mock.calls[0][0].recipientUserIds,
    ).toEqual(['u1']);
  });

  it('warnBatch email OFF (default) → KHÔNG enqueue email', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM no_show_cases nc') && sql.includes("'risk'"))
        return Promise.resolve([
          { id: 'c1', booking_id: 'b1', meeting_id: 'm1', room_id: 'r1' },
        ]);
      if (sql.includes('UPDATE no_show_cases'))
        return Promise.resolve(ret([{ id: 'c1' }]));
      if (sql.includes('FROM meetings')) return Promise.resolve(meetingRow);
      return Promise.resolve([]);
    });
    await service.warnBatch();
    expect(notifMock.enqueueEmailNotification).not.toHaveBeenCalled();
  });

  it('warnBatch email ON → enqueue với users.email', async () => {
    cfg = { NO_SHOW_ALERT_EMAIL_ENABLED: true };
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM no_show_cases nc') && sql.includes("'risk'"))
        return Promise.resolve([
          { id: 'c1', booking_id: 'b1', meeting_id: 'm1', room_id: 'r1' },
        ]);
      if (sql.includes('UPDATE no_show_cases'))
        return Promise.resolve(ret([{ id: 'c1' }]));
      if (sql.includes('FROM meetings')) return Promise.resolve(meetingRow);
      if (sql.includes('FROM users'))
        return Promise.resolve([{ email: 'a@x.com' }, { email: null }]);
      return Promise.resolve([]);
    });
    await service.warnBatch();
    expect(notifMock.enqueueEmailNotification).toHaveBeenCalledTimes(1);
    expect(
      notifMock.enqueueEmailNotification.mock.calls[0][0].toEmails,
    ).toEqual(['a@x.com']);
  });

  // ── §4 release (R2 guards) ──
  const wireRelease = (over: {
    caseRows?: any[];
    bookingRows?: any[];
    usageRows?: any[];
  }) => {
    qrMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE no_show_cases'))
        return Promise.resolve(
          ret(
            over.caseRows ?? [
              { booking_id: 'b1', meeting_id: 'm1', room_id: 'r1' },
            ],
          ),
        );
      if (sql.includes('UPDATE room_bookings'))
        return Promise.resolve(ret(over.bookingRows ?? [{ id: 'b1' }]));
      if (sql.includes('UPDATE room_booking_usages'))
        return Promise.resolve(ret(over.usageRows ?? [{ id: 'us1' }]));
      if (sql.includes('INSERT INTO room_events')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    dsMock.manager.query.mockResolvedValue([
      { organizer_id: 'u1', host_id: null },
    ]);
  };

  it('release manual success → released:true + commit + audit', async () => {
    wireRelease({});
    const r = await service.release({
      caseId: 'c1',
      actor: 'admin1',
      reason: 'admin reason',
      mode: 'manual',
    });
    expect(r).toEqual({ released: true });
    expect(qrMock.commitTransaction).toHaveBeenCalled();
    expect(auditMock.logAction).toHaveBeenCalledTimes(1);
    // 4 mutate: case, booking, usage, room_events insert
    const sqls = qrMock.manager.query.mock.calls.map((c: any[]) => c[0]);
    expect(sqls.some((s: string) => s.includes('UPDATE room_bookings'))).toBe(
      true,
    );
    expect(
      sqls.some((s: string) => s.includes('INSERT INTO room_events')),
    ).toBe(true);
  });

  it('release auto → resolution released, KHÔNG audit (system)', async () => {
    wireRelease({});
    const r = await service.release({
      caseId: 'c1',
      actor: null,
      reason: 'auto_release_no_show',
      mode: 'auto',
    });
    expect(r.released).toBe(true);
    expect(auditMock.logAction).not.toHaveBeenCalled();
  });

  it('release guard case: 0 row → already_released + rollback', async () => {
    wireRelease({ caseRows: [] });
    const r = await service.release({
      caseId: 'c1',
      actor: 'admin1',
      reason: 'x',
      mode: 'manual',
    });
    expect(r).toEqual({ released: false, skipped: 'already_released' });
    expect(qrMock.rollbackTransaction).toHaveBeenCalled();
    expect(qrMock.commitTransaction).not.toHaveBeenCalled();
  });

  it('release guard booking: 0 row → booking_changed + rollback toàn bộ', async () => {
    wireRelease({ bookingRows: [] });
    const r = await service.release({
      caseId: 'c1',
      actor: null,
      reason: 'x',
      mode: 'auto',
    });
    expect(r).toEqual({ released: false, skipped: 'booking_changed' });
    expect(qrMock.rollbackTransaction).toHaveBeenCalled();
  });

  it('release usage thiếu row → vẫn released (usageMutated=false)', async () => {
    wireRelease({ usageRows: [] });
    const r = await service.release({
      caseId: 'c1',
      actor: null,
      reason: 'x',
      mode: 'auto',
    });
    expect(r).toEqual({ released: true });
    const ev = qrMock.manager.query.mock.calls.find((c: any[]) =>
      c[0].includes('INSERT INTO room_events'),
    );
    // metadata_json là tham số thứ 7 (index 6), dạng JSON string.
    expect(ev[1][6]).toContain('"usageMutated":false');
  });

  // ── #33 autoReleaseBatch ──
  it('autoReleaseBatch: 1 release ok + 1 throw → released=1 skipped=1 (batch không dừng)', async () => {
    dsMock.manager.query.mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }]);
    const spy = jest
      .spyOn(service, 'release')
      .mockResolvedValueOnce({ released: true })
      .mockRejectedValueOnce(new Error('boom'));
    const r = await service.autoReleaseBatch();
    expect(r).toEqual({ scanned: 2, released: 1, skipped: 1 });
    expect(spy.mock.calls[0][0].reason).toBe('auto_release_no_show');
    expect(spy.mock.calls[0][0].mode).toBe('auto');
  });

  // ── #33b manualRelease mapping (A) ──
  const caseStatus = (s: string | null) =>
    dsMock.manager.query.mockResolvedValueOnce(
      s === null ? [] : [{ id: 'c1', detection_status: s }],
    );

  it('manualRelease: case không tồn tại → NotFound', async () => {
    caseStatus(null);
    await expect(service.manualRelease('c1', 'r', 'a')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('manualRelease: dismissed → BadRequest', async () => {
    caseStatus('dismissed');
    await expect(service.manualRelease('c1', 'r', 'a')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('manualRelease: đã released → 200 no-op (released:false)', async () => {
    caseStatus('released');
    const out = await service.manualRelease('c1', 'r', 'a');
    expect(out).toMatchObject({ released: false });
  });

  it('manualRelease: warning_sent → gọi release, released:true', async () => {
    caseStatus('warning_sent');
    jest.spyOn(service, 'release').mockResolvedValue({ released: true });
    const out = await service.manualRelease('c1', 'r', 'a');
    expect(out).toMatchObject({ released: true });
  });

  it('manualRelease: release skip booking_changed → Conflict 409', async () => {
    caseStatus('warning_sent');
    jest
      .spyOn(service, 'release')
      .mockResolvedValue({ released: false, skipped: 'booking_changed' });
    await expect(service.manualRelease('c1', 'r', 'a')).rejects.toThrow(
      ConflictException,
    );
  });

  it('manualRelease: release skip already_released → 200 no-op', async () => {
    caseStatus('warning_sent');
    jest
      .spyOn(service, 'release')
      .mockResolvedValue({ released: false, skipped: 'already_released' });
    const out = await service.manualRelease('c1', 'r', 'a');
    expect(out).toMatchObject({ released: false });
  });
});
