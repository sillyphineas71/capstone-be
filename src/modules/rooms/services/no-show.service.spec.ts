/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NoShowService } from './no-show.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';

describe('NoShowService (NSC-001 / UC-41+42)', () => {
  let service: NoShowService;
  let dsMock: any;
  let wsMock: any;
  let insertRows: any[];
  let existingRows: any[];
  let currentRows: any[];
  let updatedRows: any[];

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
    ...over,
  });

  beforeEach(async () => {
    insertRows = [row()];
    existingRows = [row()];
    currentRows = [row()];
    updatedRows = [row({ detection_status: 'dismissed' })];
    dsMock = {
      manager: {
        query: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT INTO no_show_cases'))
            return Promise.resolve(insertRows);
          if (sql.includes('UPDATE no_show_cases'))
            return Promise.resolve(updatedRows);
          if (sql.includes('WHERE booking_id'))
            return Promise.resolve(existingRows);
          if (sql.includes('WHERE id =')) return Promise.resolve(currentRows);
          return Promise.resolve([]);
        }),
      },
    };
    wsMock = { emitToRoom: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoShowService,
        { provide: DataSource, useValue: dsMock },
        { provide: WebsocketService, useValue: wsMock },
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
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'room:rm-1',
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
});
