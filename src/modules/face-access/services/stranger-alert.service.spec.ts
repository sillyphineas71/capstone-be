/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { StrangerAlertService } from './stranger-alert.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { AlertRulesService } from '../../alerts/services/alert-rules.service.js';
import { AlertsService } from '../../alerts/services/alerts.service.js';

const evt = (over: any = {}) => ({
  deviceId: 'dev1',
  deviceCode: 'FACE-1',
  roomId: 'room1',
  strangerId: 's1',
  similarity: '88',
  capturedAt: new Date('2026-06-19T09:00:00.000Z'),
  ...over,
});

describe('StrangerAlertService (SAL-001)', () => {
  let service: StrangerAlertService;
  let dsMock: any;
  let wsMock: any;
  let notifMock: any;
  let alertRulesMock: any;
  let alertsMock: any;
  let cfg: Record<string, unknown>;

  const adminRows = [{ id: 'a1', email: 'a1@x.com' }];

  const build = async () => {
    dsMock = {
      manager: {
        query: jest.fn((sql: string) => {
          if (sql.includes('FROM users')) return Promise.resolve(adminRows);
          if (sql.includes('face_stranger')) return Promise.resolve([]);
          return Promise.resolve([]);
        }),
      },
    };
    wsMock = { emitToRoom: jest.fn() };
    notifMock = {
      createNotification: jest.fn().mockResolvedValue({}),
      enqueueEmailNotification: jest.fn().mockResolvedValue({}),
    };
    alertRulesMock = {
      findEffectiveRule: jest
        .fn()
        .mockResolvedValue({ rule: null, suppressed: false }),
    };
    alertsMock = { recordAlert: jest.fn().mockResolvedValue({ isNew: true }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrangerAlertService,
        { provide: DataSource, useValue: dsMock },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
        { provide: WebsocketService, useValue: wsMock },
        { provide: NotificationsService, useValue: notifMock },
        { provide: AlertRulesService, useValue: alertRulesMock },
        { provide: AlertsService, useValue: alertsMock },
      ],
    }).compile();
    service = module.get(StrangerAlertService);
  };

  beforeEach(async () => {
    cfg = {};
    await build();
  });

  // ── onStranger ──
  it('throttle MISS (lần đầu): WS emit + createNotification 1 lần', async () => {
    await service.onStranger(evt());
    expect(wsMock.emitToRoom).toHaveBeenCalledTimes(1);
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'room:room1',
      'face.stranger.alert',
      expect.objectContaining({ deviceId: 'dev1', roomId: 'room1' }),
    );
    expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
    const dto = notifMock.createNotification.mock.calls[0][0];
    expect(dto.notificationType).toBe('unknown_face_alert');
    expect(dto.recipientUserIds).toEqual(['a1']);
    // metadata-only: KHÔNG base64/SanpPic
    expect(JSON.stringify(dto.payloadJson)).not.toContain('SanpPic');
    expect(JSON.stringify(dto.payloadJson)).not.toContain('base64');
  });

  it('throttle HIT (cùng device trong window): lần 2 KHÔNG WS/notification', async () => {
    await service.onStranger(evt());
    await service.onStranger(evt());
    expect(wsMock.emitToRoom).toHaveBeenCalledTimes(1);
    expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
  });

  it('device khác → KHÔNG throttle (mỗi device riêng)', async () => {
    await service.onStranger(evt({ deviceId: 'dev1' }));
    await service.onStranger(evt({ deviceId: 'dev2' }));
    expect(notifMock.createNotification).toHaveBeenCalledTimes(2);
  });

  it('room null → KHÔNG emitToRoom nhưng vẫn createNotification', async () => {
    await service.onStranger(evt({ roomId: null }));
    expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
  });

  it('email OFF (default) → KHÔNG enqueueEmailNotification', async () => {
    await service.onStranger(evt());
    expect(notifMock.enqueueEmailNotification).not.toHaveBeenCalled();
  });

  it('email ON → enqueueEmailNotification (metadata-only)', async () => {
    cfg = { STRANGER_ALERT_EMAIL_ENABLED: true };
    await build();
    await service.onStranger(evt());
    expect(notifMock.enqueueEmailNotification).toHaveBeenCalledTimes(1);
    const dto = notifMock.enqueueEmailNotification.mock.calls[0][0];
    expect(dto.toEmails).toEqual(['a1@x.com']);
    expect(JSON.stringify(dto.payloadJson)).not.toContain('SanpPic');
  });

  it('không có admin → skip notification (không throw)', async () => {
    dsMock.manager.query.mockImplementation((sql: string) =>
      sql.includes('FROM users') ? Promise.resolve([]) : Promise.resolve([]),
    );
    await expect(service.onStranger(evt())).resolves.toBeUndefined();
    expect(notifMock.createNotification).not.toHaveBeenCalled();
  });

  // ── ASM-001 (Bước 3 / 3d) — recordAlert wiring ──
  it('suppressed=true → KHÔNG WS, KHÔNG recordAlert, KHÔNG notification (AF1)', async () => {
    alertRulesMock.findEffectiveRule.mockResolvedValue({
      rule: null,
      suppressed: true,
    });
    await service.onStranger(evt());
    expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    expect(notifMock.createNotification).not.toHaveBeenCalled();
  });

  it('không suppressed → recordAlert gọi với alertType=stranger, zoneId=null, payload=meta', async () => {
    await service.onStranger(evt());
    expect(alertsMock.recordAlert).toHaveBeenCalledTimes(1);
    const input = alertsMock.recordAlert.mock.calls[0][0];
    expect(input.alertType).toBe('stranger');
    expect(input.zoneId).toBeNull();
    expect(input.payloadJson).toMatchObject({
      deviceId: 'dev1',
      roomId: 'room1',
    });
  });

  it('recordAlert lỗi → NotThrow riêng, WS/notification VẪN chạy như cũ', async () => {
    alertsMock.recordAlert.mockRejectedValue(new Error('db down'));
    await expect(service.onStranger(evt())).resolves.toBeUndefined();
    expect(wsMock.emitToRoom).toHaveBeenCalledTimes(1);
    expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
  });

  it('ruleId truyền từ findEffectiveRule khi có rule', async () => {
    alertRulesMock.findEffectiveRule.mockResolvedValue({
      rule: { id: 'rule-9' },
      suppressed: false,
    });
    await service.onStranger(evt());
    expect(alertsMock.recordAlert.mock.calls[0][0].ruleId).toBe('rule-9');
  });

  // FIX: role_code cũ là 'admin' (chữ thường) — KHÔNG khớp role nào trong 4 role thật
  // (SYSTEM_ADMIN/BUSINESS_ADMIN/MANAGER/EMPLOYEE) ⇒ cảnh báo không gửi cho ai.
  it('resolveAdmins lọc SYSTEM_ADMIN + BUSINESS_ADMIN, KHÔNG dùng literal chữ thường', async () => {
    await service.onStranger(evt());

    const adminSql = (dsMock.manager.query.mock.calls as Array<[string]>)
      .map((c) => c[0])
      .find((sql) => sql.includes('FROM users'));

    expect(adminSql).toBeDefined();
    expect(adminSql).toContain('SYSTEM_ADMIN');
    expect(adminSql).toContain('BUSINESS_ADMIN');
    // literal cũ gây bug phải biến mất hoàn toàn
    expect(adminSql).not.toContain("'admin'");
    // MANAGER CHƯA được thêm (chờ chốt với phần cảnh báo an ninh)
    expect(adminSql).not.toContain('MANAGER');
    // giữ nguyên điều kiện soft-delete
    expect(adminSql).toContain('u.deleted_at IS NULL');
  });

  // ── list ──
  it('list: query face_stranger + window; KHÔNG select payload base64; map field', async () => {
    let captured = '';
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('face_stranger')) {
        captured = sql;
        return Promise.resolve([
          {
            device_id: 'dev1',
            stranger_id: 's1',
            last_seen: '2026-06-19T09:00:00Z',
            hit_count: 4,
            room_id: 'room1',
            similarity: '88',
          },
        ]);
      }
      return Promise.resolve([]);
    });
    const r = await service.list({ page: 1, limit: 20 });
    expect(r.data).toEqual([
      {
        deviceId: 'dev1',
        strangerId: 's1',
        roomId: 'room1',
        similarity: '88',
        lastSeen: '2026-06-19T09:00:00Z',
        hitCount: 4,
      },
    ]);
    expect(captured).toContain("event_type = 'face_stranger'");
    expect(captured).toContain('created_at >= now() - ($1');
    // SEC-02: KHÔNG select raw payload / SanpPic
    expect(captured).not.toContain('raw_payload_sample');
    expect(captured).not.toContain('SanpPic');
  });

  it('list: phân trang → LIMIT/OFFSET param đúng', async () => {
    let p: any[] = [];
    dsMock.manager.query.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes('face_stranger')) {
        p = params ?? [];
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    await service.list({ page: 3, limit: 10 });
    expect(p).toEqual([1440, 10, 20]);
  });
});
