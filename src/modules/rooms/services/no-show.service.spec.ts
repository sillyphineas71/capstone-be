/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { NoShowService } from './no-show.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { NoShowConfigService } from './no-show-config.service.js';

describe('NoShowService (NSC-001 / UC-41+42)', () => {
  let service: NoShowService;
  let dsMock: any;
  let wsMock: any;
  let authzMock: any;
  let configMock: any;
  let insertRows: any[];
  let existingRows: any[];
  let currentRows: any[];
  let updatedRows: any[];
  let meetingRows: any[];
  let permissions: string[];
  let confirmExtensionMinutes: number;

  const row = (over: any = {}) => ({
    id: 'nsc-1',
    booking_id: 'bk-1',
    meeting_id: 'mt-1',
    room_id: 'rm-1',
    detection_status: 'risk',
    detected_at: '2026-06-17T09:00:00Z',
    warning_sent_at: null,
    released_at: null,
    resolved_by: null,
    resolution_status: null,
    note: null,
    evidence_json: { threshold: 15 },
    snooze_until: null,
    ...over,
  });

  beforeEach(async () => {
    insertRows = [row()];
    existingRows = [row()];
    currentRows = [row()];
    updatedRows = [row({ detection_status: 'dismissed' })];
    // [FIX 2026-08-09, Phần 5] Mặc định: user CÓ quyền room.noshow.update (mirror hành
    // vi cũ PermissionsGuard từng cho qua) — mọi test update() KHÔNG khai báo riêng đều
    // đi qua nhánh permission-cũ, KHÔNG âm thầm rơi vào nhánh ownership mới.
    permissions = ['room.noshow.update'];
    meetingRows = [{ organizer_id: 'organizer-1', host_id: 'host-1' }];
    confirmExtensionMinutes = 10;
    dsMock = {
      manager: {
        query: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT INTO no_show_cases'))
            return Promise.resolve(insertRows);
          if (sql.includes('UPDATE no_show_cases'))
            return Promise.resolve(updatedRows);
          if (sql.includes('WHERE booking_id'))
            return Promise.resolve(existingRows);
          if (sql.includes('FROM meetings'))
            return Promise.resolve(meetingRows);
          if (sql.includes('WHERE id =')) return Promise.resolve(currentRows);
          return Promise.resolve([]);
        }),
      },
    };
    wsMock = { emitToRoom: jest.fn() };
    authzMock = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ roles: [], permissions })),
    };
    configMock = {
      getValues: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ confirmExtensionMinutes })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoShowService,
        { provide: DataSource, useValue: dsMock },
        { provide: WebsocketService, useValue: wsMock },
        { provide: AuthzReadRepository, useValue: authzMock },
        { provide: NoShowConfigService, useValue: configMock },
      ],
    }).compile();
    service = module.get(NoShowService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── CREATE ───
  it('create insert → created=true + emit meeting.noshow.alert', async () => {
    const r = await service.create({
      bookingId: 'bk-1',
      meetingId: 'mt-1',
      roomId: 'rm-1',
    });
    expect(r.created).toBe(true);
    expect(r.case.id).toBe('nsc-1');
    // [FIX 2026-08-13] WS phải emit vào meeting:${meetingId} — room:${roomId} không có
    // client nào từng join (host chỉ join meeting:<id>), event chết trên đường đi.
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'meeting:mt-1',
      'meeting.noshow.alert',
      expect.objectContaining({ noShowCaseId: 'nsc-1', roomId: 'rm-1' }),
    );
    // atomic dedup SQL
    const insertSql = String(dsMock.manager.query.mock.calls[0][0]);
    expect(insertSql).toContain('WHERE NOT EXISTS');
  });

  it('create existing (INSERT 0 row) → created=false + KHÔNG emit (idempotent)', async () => {
    insertRows = [];
    const r = await service.create({
      bookingId: 'bk-1',
      meetingId: 'mt-1',
      roomId: 'rm-1',
    });
    expect(r.created).toBe(false);
    expect(r.case.id).toBe('nsc-1');
    expect(wsMock.emitToRoom).not.toHaveBeenCalled();
  });

  it('create: WS lỗi → vẫn trả case (best-effort)', async () => {
    wsMock.emitToRoom.mockImplementation(() => {
      throw new Error('ws down');
    });
    const r = await service.create({
      bookingId: 'bk-1',
      meetingId: 'mt-1',
      roomId: 'rm-1',
    });
    expect(r.created).toBe(true);
  });

  it('create với evidenceJson + detectionStatus=confirmed → lưu evidence + status', async () => {
    await service.create({
      bookingId: 'bk-1',
      meetingId: 'mt-1',
      roomId: 'rm-1',
      detectionStatus: 'confirmed',
      evidenceJson: { occupancyCount: 0 },
    });
    const insertParams = dsMock.manager.query.mock.calls[0][1];
    expect(insertParams[3]).toBe('confirmed');
    expect(insertParams[4]).toContain('occupancyCount');
  });

  // ─── UPDATE ───
  it('update valid {dismissed/false_positive} → UPDATE + resolved_by', async () => {
    const r = await service.update(
      'nsc-1',
      { detectionStatus: 'dismissed', resolutionStatus: 'false_positive' },
      'user-1',
    );
    expect(r.detectionStatus).toBe('dismissed');
    const updateParams = dsMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('UPDATE no_show_cases'),
    )[1];
    expect(updateParams[1]).toBe('dismissed'); // detection_status
    expect(updateParams[4]).toBe('user-1'); // resolved_by
  });

  it('update note-only → resolved_by KHÔNG set (không resolving)', async () => {
    await service.update('nsc-1', { note: 'just a note' }, 'user-1');
    const updateParams = dsMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('UPDATE no_show_cases'),
    )[1];
    expect(updateParams[4]).toBeNull(); // resolved_by null
  });

  it('update illegal transition (released) → 400 INVALID_NO_SHOW_TRANSITION', async () => {
    await expect(
      service.update('nsc-1', { detectionStatus: 'released' }, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('update target ngoài allowed (risk) → 400 INVALID_DETECTION_STATUS', async () => {
    await expect(
      service.update('nsc-1', { detectionStatus: 'risk' }, 'u1'),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_DETECTION_STATUS' },
    });
  });

  it('update terminal case (đã resolved) → 400 (no re-open)', async () => {
    currentRows = [row({ detection_status: 'resolved' })];
    await expect(
      service.update('nsc-1', { note: 'x' }, 'u1'),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_NO_SHOW_TRANSITION' },
    });
  });

  it('update 404 → NO_SHOW_CASE_NOT_FOUND', async () => {
    currentRows = [];
    await expect(service.update('nsc-1', { note: 'x' }, 'u1')).rejects.toThrow(
      NotFoundException,
    );
  });

  // ══ Phần 5 (R5.1) — authorization chuyển vào service: permission cũ HOẶC dismiss+ownership ══
  describe('Phần 5: host/organizer tự dismiss case của chính mình', () => {
    it('1. User CÓ room.noshow.update → mọi transition vẫn hoạt động y hệt trước (regression)', async () => {
      permissions = ['room.noshow.update'];
      await expect(
        service.update(
          'nsc-1',
          { detectionStatus: 'confirmed' },
          'someone-with-permission',
        ),
      ).resolves.toBeDefined();
      // UPDATE thật sự chạy với đúng dto đã truyền (KHÔNG bị chặn bởi authorization mới).
      const updateCall = dsMock.manager.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('UPDATE no_show_cases'),
      );
      expect(updateCall[1][1]).toBe('confirmed'); // detection_status
      // KHÔNG cần query meetings khi đã có permission — không tốn round-trip thừa.
      expect(
        dsMock.manager.query.mock.calls.some((c: any[]) =>
          String(c[0]).includes('FROM meetings'),
        ),
      ).toBe(false);
    });

    it('2. User KHÔNG có quyền, LÀ organizer, dismissed → cho phép', async () => {
      permissions = [];
      meetingRows = [{ organizer_id: 'user-1', host_id: 'other-host' }];
      await expect(
        service.update('nsc-1', { detectionStatus: 'dismissed' }, 'user-1'),
      ).resolves.toBeDefined();
    });

    it('3. User KHÔNG có quyền, LÀ host (không phải organizer), dismissed → cho phép', async () => {
      permissions = [];
      meetingRows = [{ organizer_id: 'other-organizer', host_id: 'user-1' }];
      await expect(
        service.update('nsc-1', { detectionStatus: 'dismissed' }, 'user-1'),
      ).resolves.toBeDefined();
    });

    it('4. User KHÔNG có quyền, KHÔNG phải organizer/host, dismissed → 403 ĐÚNG code/message y hệt Guard cũ', async () => {
      permissions = [];
      meetingRows = [{ organizer_id: 'other-1', host_id: 'other-2' }];
      await expect(
        service.update('nsc-1', { detectionStatus: 'dismissed' }, 'user-1'),
      ).rejects.toMatchObject({
        response: {
          success: false,
          message: 'Bạn không có quyền thực hiện hành động này.',
          error: { code: 'FORBIDDEN', details: {} },
        },
      });
      await expect(
        service.update('nsc-1', { detectionStatus: 'dismissed' }, 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("5. User KHÔNG có quyền, LÀ organizer, NHƯNG detectionStatus='confirmed' (không phải dismissed) → vẫn 403", async () => {
      permissions = [];
      meetingRows = [{ organizer_id: 'user-1', host_id: 'other-host' }];
      await expect(
        service.update('nsc-1', { detectionStatus: 'confirmed' }, 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('6. Case ĐÃ terminal (released) + user là organizer + dismissed → vẫn 400 TERMINAL, KHÔNG bị bypass bởi nhánh ownership mới', async () => {
      currentRows = [row({ detection_status: 'released' })];
      permissions = [];
      meetingRows = [{ organizer_id: 'user-1', host_id: 'other-host' }];
      await expect(
        service.update('nsc-1', { detectionStatus: 'dismissed' }, 'user-1'),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_NO_SHOW_TRANSITION' },
      });
      // Xác nhận KHÔNG bị nhảy qua: terminal check chạy TRƯỚC, KHÔNG hề query meetings.
      expect(
        dsMock.manager.query.mock.calls.some((c: any[]) =>
          String(c[0]).includes('FROM meetings'),
        ),
      ).toBe(false);
    });
  });

  // ─── LIST (GET no-show-cases) ───
  const listRow = (over: any = {}) => ({
    id: 'nsc-1',
    room_id: 'rm-1',
    room_name: 'Room A',
    meeting_id: 'mt-1',
    detection_status: 'risk',
    detected_at: '2026-06-17T09:00:00Z',
    warning_sent_at: null,
    released_at: null,
    ...over,
  });

  const mockList = (total: number, rows: any[]) => {
    dsMock.manager.query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('COUNT(*)')) return Promise.resolve([{ total }]);
      if (sql.includes('LEFT JOIN rooms')) return Promise.resolve(rows);
      return Promise.resolve([]);
    });
  };

  it('list rỗng → data [] + meta total 0, totalPages 0', async () => {
    mockList(0, []);
    const r = await service.list({});
    expect(r.items).toEqual([]);
    expect(r.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it('list map đúng field FE (id/roomId/roomName/status/detectedAt...)', async () => {
    mockList(1, [listRow()]);
    const r = await service.list({});
    expect(r.items[0]).toEqual({
      id: 'nsc-1',
      roomId: 'rm-1',
      roomName: 'Room A',
      meetingId: 'mt-1',
      status: 'risk',
      detectedAt: '2026-06-17T09:00:00Z',
      warningSentAt: null,
      releasedAt: null,
    });
  });

  it('list phân trang page=2 limit=20 total=45 → totalPages 3 + OFFSET 20', async () => {
    mockList(45, [listRow()]);
    const r = await service.list({ page: 2, limit: 20 });
    expect(r.meta).toEqual({ page: 2, limit: 20, total: 45, totalPages: 3 });
    const dataCall = dsMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('LEFT JOIN rooms'),
    );
    // params tail = [..., limit, offset]
    expect(dataCall[1].slice(-2)).toEqual([20, 20]);
  });

  it('list lọc status → WHERE detection_status + param', async () => {
    mockList(1, [listRow()]);
    await service.list({ status: 'confirmed' });
    const dataCall = dsMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('LEFT JOIN rooms'),
    );
    expect(String(dataCall[0])).toContain('n.detection_status = $1');
    expect(dataCall[1]).toContain('confirmed');
  });

  it('list lọc roomId → WHERE room_id + param', async () => {
    mockList(1, [listRow()]);
    await service.list({ roomId: 'rm-9' });
    const dataCall = dsMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('LEFT JOIN rooms'),
    );
    expect(String(dataCall[0])).toContain('n.room_id = $1');
    expect(dataCall[1]).toContain('rm-9');
  });

  // ══ [Việc B, tái đánh giá 2026-08-21] snooze() — "Tôi vẫn đến" gia hạn, KHÔNG terminal ══
  describe('snooze() — Việc B tái đánh giá 2026-08-21', () => {
    it('từ risk → UPDATE detection_status=snoozed, bind confirmExtensionMinutes từ config, trả extensionMinutes + alreadySnoozed=false', async () => {
      currentRows = [row({ detection_status: 'risk' })];
      updatedRows = [
        row({
          detection_status: 'snoozed',
          snooze_until: '2026-08-21T11:00:00Z',
          resolved_by: 'user-1',
        }),
      ];
      const r = await service.snooze('nsc-1', 'user-1');
      expect(r.detectionStatus).toBe('snoozed');
      expect(r.snoozeUntil).toBe('2026-08-21T11:00:00Z');
      expect(r.alreadySnoozed).toBe(false);
      expect(r.extensionMinutes).toBe(10);

      const updateCall = dsMock.manager.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('UPDATE no_show_cases'),
      );
      expect(String(updateCall[0])).toContain("detection_status = 'snoozed'");
      expect(String(updateCall[0])).toContain(
        "snooze_until = now() + ($2::int * interval '1 minute')",
      );
      expect(updateCall[1]).toEqual([
        'nsc-1',
        10,
        null,
        'user-1',
        ['risk', 'warning_sent'],
      ]);
    });

    it('từ warning_sent → cũng cho phép snooze (nguồn hợp lệ thứ 2)', async () => {
      currentRows = [row({ detection_status: 'warning_sent' })];
      updatedRows = [row({ detection_status: 'snoozed' })];
      await expect(service.snooze('nsc-1', 'user-1')).resolves.toMatchObject({
        detectionStatus: 'snoozed',
      });
    });

    it('đọc confirmExtensionMinutes từ NoShowConfigService (không hard-code) — đổi config → đổi bind param', async () => {
      confirmExtensionMinutes = 25;
      currentRows = [row({ detection_status: 'risk' })];
      updatedRows = [row({ detection_status: 'snoozed' })];
      await service.snooze('nsc-1', 'user-1');
      const updateCall = dsMock.manager.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('UPDATE no_show_cases'),
      );
      expect(updateCall[1][1]).toBe(25);
      expect(configMock.getValues).toHaveBeenCalledTimes(1);
    });

    it('idempotent: case đã snoozed từ trước → trả alreadySnoozed=true NGAY, KHÔNG gọi UPDATE (không gia hạn thêm)', async () => {
      currentRows = [
        row({
          detection_status: 'snoozed',
          snooze_until: '2026-08-21T11:00:00Z',
        }),
      ];
      const r = await service.snooze('nsc-1', 'user-1');
      expect(r.alreadySnoozed).toBe(true);
      expect(r.snoozeUntil).toBe('2026-08-21T11:00:00Z');
      expect(
        dsMock.manager.query.mock.calls.some((c: any[]) =>
          String(c[0]).includes('UPDATE no_show_cases'),
        ),
      ).toBe(false);
    });

    it('race: UPDATE thua (0 row, request khác vừa snooze trước) → re-fetch thấy đã snoozed → alreadySnoozed=true, KHÔNG throw lỗi', async () => {
      let selectCount = 0;
      dsMock.manager.query = jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('UPDATE no_show_cases')) return Promise.resolve([]);
        if (sql.includes('FROM meetings')) return Promise.resolve(meetingRows);
        if (sql.includes('WHERE id =')) {
          selectCount++;
          // Lượt 1 (SELECT ban đầu): risk — đủ điều kiện thử snooze.
          // Lượt 2 (re-fetch sau khi UPDATE thua race): đã snoozed bởi request khác.
          return Promise.resolve(
            selectCount === 1
              ? [row({ detection_status: 'risk' })]
              : [
                  row({
                    detection_status: 'snoozed',
                    snooze_until: '2026-08-21T11:00:00Z',
                  }),
                ],
          );
        }
        return Promise.resolve([]);
      });
      const r = await service.snooze('nsc-1', 'user-1');
      expect(r.alreadySnoozed).toBe(true);
      expect(r.snoozeUntil).toBe('2026-08-21T11:00:00Z');
      expect(selectCount).toBe(2);
    });

    it('race: UPDATE thua (0 row) NHƯNG re-fetch thấy case đã terminal thật (vd released bởi auto-release) → 400 INVALID_NO_SHOW_TRANSITION', async () => {
      let selectCount = 0;
      dsMock.manager.query = jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('UPDATE no_show_cases')) return Promise.resolve([]);
        if (sql.includes('FROM meetings')) return Promise.resolve(meetingRows);
        if (sql.includes('WHERE id =')) {
          selectCount++;
          return Promise.resolve(
            selectCount === 1
              ? [row({ detection_status: 'warning_sent' })]
              : [row({ detection_status: 'released' })],
          );
        }
        return Promise.resolve([]);
      });
      await expect(service.snooze('nsc-1', 'user-1')).rejects.toMatchObject({
        response: { code: 'INVALID_NO_SHOW_TRANSITION' },
      });
    });

    it('case đã terminal thật (dismissed/released/resolved) NGAY từ đầu → 400, KHÔNG gọi UPDATE', async () => {
      currentRows = [row({ detection_status: 'dismissed' })];
      await expect(service.snooze('nsc-1', 'user-1')).rejects.toMatchObject({
        response: { code: 'INVALID_NO_SHOW_TRANSITION' },
      });
      expect(
        dsMock.manager.query.mock.calls.some((c: any[]) =>
          String(c[0]).includes('UPDATE no_show_cases'),
        ),
      ).toBe(false);
    });

    it('case không terminal nhưng cũng không phải nguồn hợp lệ (vd confirmed) → 400 INVALID_NO_SHOW_TRANSITION', async () => {
      currentRows = [row({ detection_status: 'confirmed' })];
      await expect(service.snooze('nsc-1', 'user-1')).rejects.toMatchObject({
        response: { code: 'INVALID_NO_SHOW_TRANSITION' },
      });
    });

    it('404 khi case không tồn tại', async () => {
      currentRows = [];
      await expect(service.snooze('nsc-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    // ── Authorization: mirror ĐÚNG dismiss cũ (organizer/host hoặc room.noshow.update) ──
    it('user CÓ room.noshow.update → snooze bất kỳ ai, không cần ownership', async () => {
      permissions = ['room.noshow.update'];
      currentRows = [row({ detection_status: 'risk' })];
      updatedRows = [row({ detection_status: 'snoozed' })];
      await expect(
        service.snooze('nsc-1', 'someone-with-permission'),
      ).resolves.toMatchObject({ detectionStatus: 'snoozed' });
    });

    it('user KHÔNG có quyền, LÀ organizer → cho phép snooze', async () => {
      permissions = [];
      meetingRows = [{ organizer_id: 'user-1', host_id: 'other-host' }];
      currentRows = [row({ detection_status: 'risk' })];
      updatedRows = [row({ detection_status: 'snoozed' })];
      await expect(service.snooze('nsc-1', 'user-1')).resolves.toMatchObject({
        detectionStatus: 'snoozed',
      });
    });

    it('user KHÔNG có quyền, LÀ host → cho phép snooze', async () => {
      permissions = [];
      meetingRows = [{ organizer_id: 'other-organizer', host_id: 'user-1' }];
      currentRows = [row({ detection_status: 'risk' })];
      updatedRows = [row({ detection_status: 'snoozed' })];
      await expect(service.snooze('nsc-1', 'user-1')).resolves.toMatchObject({
        detectionStatus: 'snoozed',
      });
    });

    it('user KHÔNG có quyền, KHÔNG phải organizer/host → 403', async () => {
      permissions = [];
      meetingRows = [{ organizer_id: 'other-1', host_id: 'other-2' }];
      currentRows = [row({ detection_status: 'risk' })];
      await expect(service.snooze('nsc-1', 'user-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('userId null → 403 (chặn sớm, không query thêm)', async () => {
      currentRows = [row({ detection_status: 'risk' })];
      await expect(service.snooze('nsc-1', null)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
