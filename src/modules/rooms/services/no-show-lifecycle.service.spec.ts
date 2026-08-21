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
import { NoShowConfirmTokenService } from './no-show-confirm-token.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { LiveMeetingService } from '../../live-meeting/services/live-meeting.service.js';

// Shape helpers: UPDATE…RETURNING → [rows,count]; SELECT/INSERT → rows.
const ret = (rows: any[]) => [rows, rows.length];

describe('NoShowLifecycleService (NSL-001)', () => {
  let service: NoShowLifecycleService;
  let dsMock: any;
  let qrMock: any;
  let wsMock: any;
  let notifMock: any;
  let auditMock: any;
  let liveMeetingMock: any;
  let confirmTokenMock: any;
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
    liveMeetingMock = { endMeeting: jest.fn().mockResolvedValue({}) };
    confirmTokenMock = {
      sign: jest.fn().mockResolvedValue('signed-token'),
      buildLink: jest
        .fn()
        .mockImplementation(
          (base: string, token: string) => `${base}/no-show-confirm/${token}`,
        ),
    };
    configValues = {
      thresholdMinutes: 15,
      warningGraceMinutes: 0,
      autoReleaseGraceMinutes: 5,
      autoReleaseEnabled: true,
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
        { provide: LiveMeetingService, useValue: liveMeetingMock },
        { provide: NoShowConfirmTokenService, useValue: confirmTokenMock },
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

  // [FIX 2026-08-13] WS phải emit vào meeting:${meetingId} — client (host, InMeetingRoom.jsx)
  // chỉ join meeting:<id>, KHÔNG bao giờ join room:${roomId} → event cũ chết trên đường đi.
  it('warnBatch: emit WS meeting.noshow.alert vào ĐÚNG kênh meeting:${meetingId}, không phải room:${roomId}', async () => {
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
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'meeting:m1',
      'meeting.noshow.alert',
      expect.objectContaining({
        noShowCaseId: 'c1',
        roomId: 'r1',
        kind: 'warning',
      }),
    );
    expect(wsMock.emitToRoom).not.toHaveBeenCalledWith(
      'room:r1',
      expect.anything(),
      expect.anything(),
    );
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

  // ── [Việc B, Hướng 2] Link "Tôi vẫn đến" trong email cảnh báo (kind='warning') ──
  describe('[Việc B, Hướng 2] link xác nhận trong email no-show', () => {
    it('warnBatch email ON (kind=warning) → ký token cho recipientUserIds[0], nhúng link vào emailHtml', async () => {
      cfg = {
        NO_SHOW_ALERT_EMAIL_ENABLED: true,
        APP_URL: 'https://api.example.com',
      };
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM no_show_cases nc') && sql.includes("'risk'"))
          return Promise.resolve([
            { id: 'c1', booking_id: 'b1', meeting_id: 'm1', room_id: 'r1' },
          ]);
        if (sql.includes('UPDATE no_show_cases'))
          return Promise.resolve(ret([{ id: 'c1' }]));
        if (sql.includes('FROM meetings')) return Promise.resolve(meetingRow);
        if (sql.includes('FROM users'))
          return Promise.resolve([{ email: 'a@x.com' }]);
        return Promise.resolve([]);
      });
      await service.warnBatch();
      expect(confirmTokenMock.sign).toHaveBeenCalledWith({
        caseId: 'c1',
        userId: 'u1', // recipientUserIds[0] — organizer trước, mirror thứ tự dedupe
      });
      expect(confirmTokenMock.buildLink).toHaveBeenCalledWith(
        'https://api.example.com',
        'signed-token',
      );
      const emailHtml =
        notifMock.enqueueEmailNotification.mock.calls[0][0].emailHtml;
      expect(String(emailHtml)).toContain(
        'https://api.example.com/no-show-confirm/signed-token',
      );
    });

    it('release() email ON (kind=released) → KHÔNG ký token, KHÔNG chèn link (case đã terminal, dismiss vô nghĩa)', async () => {
      cfg = {
        NO_SHOW_ALERT_EMAIL_ENABLED: true,
        APP_URL: 'https://api.example.com',
      };
      // wireRelease({}) mặc định: case→{booking_id:'b1',meeting_id:'m1',room_id:'r1'},
      // booking→[{id:'b1'}], usage→[{id:'us1'}] — khớp meetingRow (meeting_id='m1') có
      // sẵn ở trên. CHỈ override dsMock (notifyNoShow dùng dsMock, KHÔNG dùng qrMock) để
      // thêm nhánh 'FROM users' — không đụng qrMock (giữ nguyên transaction release()).
      wireRelease({});
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM meetings')) return Promise.resolve(meetingRow);
        if (sql.includes('FROM users'))
          return Promise.resolve([{ email: 'a@x.com' }]);
        return Promise.resolve([]);
      });
      await service.release({
        caseId: 'c1',
        actor: 'admin1',
        reason: 'x',
        mode: 'manual',
      });
      expect(confirmTokenMock.sign).not.toHaveBeenCalled();
      expect(notifMock.enqueueEmailNotification).toHaveBeenCalledTimes(1);
      const emailHtml =
        notifMock.enqueueEmailNotification.mock.calls[0][0].emailHtml;
      expect(String(emailHtml)).not.toContain('no-show-confirm');
    });

    it('ký token lỗi (best-effort) → KHÔNG làm hỏng email, vẫn enqueue email không có link', async () => {
      cfg = {
        NO_SHOW_ALERT_EMAIL_ENABLED: true,
        APP_URL: 'https://api.example.com',
      };
      confirmTokenMock.sign.mockRejectedValue(new Error('sign failed'));
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM no_show_cases nc') && sql.includes("'risk'"))
          return Promise.resolve([
            { id: 'c1', booking_id: 'b1', meeting_id: 'm1', room_id: 'r1' },
          ]);
        if (sql.includes('UPDATE no_show_cases'))
          return Promise.resolve(ret([{ id: 'c1' }]));
        if (sql.includes('FROM meetings')) return Promise.resolve(meetingRow);
        if (sql.includes('FROM users'))
          return Promise.resolve([{ email: 'a@x.com' }]);
        return Promise.resolve([]);
      });
      const r = await service.warnBatch();
      expect(r.warned).toBe(1);
      expect(notifMock.enqueueEmailNotification).toHaveBeenCalledTimes(1);
      const emailHtml =
        notifMock.enqueueEmailNotification.mock.calls[0][0].emailHtml;
      expect(String(emailHtml)).not.toContain('no-show-confirm');
    });
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

  // [FIX 2026-08-13] release() cũng dùng chung notifyNoShow() → phải emit đúng
  // meeting:${meetingId}, không phải room:${roomId} (mirror test warnBatch ở trên).
  it('release: emit WS meeting.noshow.alert vào ĐÚNG kênh meeting:${meetingId}, kind=released', async () => {
    wireRelease({});
    await service.release({
      caseId: 'c1',
      actor: 'admin1',
      reason: 'admin reason',
      mode: 'manual',
    });
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'meeting:m1',
      'meeting.noshow.alert',
      expect.objectContaining({ roomId: 'r1', kind: 'released' }),
    );
    expect(wsMock.emitToRoom).not.toHaveBeenCalledWith(
      'room:r1',
      expect.anything(),
      expect.anything(),
    );
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

  it('autoReleaseBatch: autoReleaseEnabled=false → skip toàn bộ, KHÔNG gọi release', async () => {
    configValues.autoReleaseEnabled = false;
    const spy = jest.spyOn(service, 'release');
    const r = await service.autoReleaseBatch();
    expect(r).toEqual({ scanned: 0, released: 0, skipped: 0 });
    expect(spy).not.toHaveBeenCalled();
    expect(dsMock.manager.query).not.toHaveBeenCalled();
  });

  // Kịch bản Dismiss (regression, không thuộc phạm vi fix hôm nay — xác nhận vẫn đúng):
  // case đã dismissed KHÔNG được auto chuyển sang released dù quá giờ. autoReleaseBatch's
  // candidate SQL tự lọc "detection_status = 'warning_sent'" — dismissed không khớp điều
  // kiện này nên KHÔNG BAO GIỜ xuất hiện trong candidate, dù đã quá auto_release_eligible_at.
  it('Kịch bản Dismiss — autoReleaseBatch chỉ quét detection_status=warning_sent, case dismissed không lọt vào dù quá giờ', async () => {
    dsMock.manager.query.mockResolvedValueOnce([]); // DB thật sẽ lọc dismissed ra, mock mô phỏng kết quả rỗng
    const spy = jest.spyOn(service, 'release');
    const r = await service.autoReleaseBatch();
    expect(r).toEqual({ scanned: 0, released: 0, skipped: 0 });
    expect(spy).not.toHaveBeenCalled();
    const sql = String(dsMock.manager.query.mock.calls[0][0]);
    expect(sql).toContain("nc.detection_status = 'warning_sent'");
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
