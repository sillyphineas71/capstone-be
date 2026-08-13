/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ForbiddenException } from '@nestjs/common';
import { IvssPresenceReportService } from './ivss-presence-report.service.js';
import { IvssPresenceQueryService } from './ivss-presence-query.service.js';

// [FIX 2026-08-13] buildMeetingReport() giờ bắt buộc callerId (chặn EMPLOYEE, scope Manager
// qua getMeetingPresence()). Caller mặc định cho mọi test PDF-render (không liên quan scope)
// luôn unrestricted, giữ nguyên hành vi các test này như trước fix.
const ADMIN_CALLER = 'admin-1';
const UNRESTRICTED_SCOPE = {
  viewerRole: 'SYSTEM_ADMIN',
  isUnrestricted: true,
  scopeDepartmentIds: null,
  selfUserId: null,
};

const HEADER = [
  {
    title: 'Daily Standup',
    meeting_code: 'MTG-001',
    start_time: '2026-06-23T09:00:00.000Z',
    end_time: '2026-06-23T10:00:00.000Z',
    status: 'completed',
    room_name: 'Room A',
  },
];
const summary = (participants: any[] = [], idCount = 0) => ({
  participants,
  meetingUnmatchedIdentityCount: idCount,
});
const isPdf = (b: Buffer) => b.slice(0, 5).toString() === '%PDF-';

describe('IvssPresenceReportService (IPR-001 #43)', () => {
  let service: IvssPresenceReportService;
  let dsMock: any;
  let queryMock: any;

  beforeEach(async () => {
    dsMock = { manager: { query: jest.fn().mockResolvedValue(HEADER) } };
    queryMock = {
      getMeetingPresence: jest.fn(),
      resolveScope: jest.fn().mockResolvedValue(UNRESTRICTED_SCOPE),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssPresenceReportService,
        { provide: DataSource, useValue: dsMock },
        { provide: IvssPresenceQueryService, useValue: queryMock },
      ],
    }).compile();
    service = module.get(IvssPresenceReportService);
  });

  it('buffer %PDF + filename đúng convention', async () => {
    queryMock.getMeetingPresence.mockResolvedValue(
      summary([
        {
          userId: 'u1',
          fullName: 'Alice',
          durationMs: 3_660_000, // 1h 01m → cover h-branch
          method: 'interval',
          presentRatio: 0.5,
          segmentCount: 2,
          unmatchedCount: 0,
        },
      ]),
    );
    const r = await service.buildMeetingReport('m1', ADMIN_CALLER);
    expect(r).not.toBeNull();
    expect(isPdf(r!.buffer)).toBe(true);
    expect(r!.filename).toMatch(/^ivss-presence-MTG-001-\d{8}\.pdf$/);
  });

  it('C1: tên VN có dấu "Trần Đức Hải" → KHÔNG throw, buffer %PDF', async () => {
    queryMock.getMeetingPresence.mockResolvedValue(
      summary([
        {
          userId: 'u1',
          fullName: 'Trần Đức Hải',
          durationMs: 120_000,
          method: 'approx',
          presentRatio: 0.2,
          segmentCount: 1,
          unmatchedCount: 2,
        },
      ]),
    );
    const r = await service.buildMeetingReport('m1', ADMIN_CALLER);
    expect(r!.buffer.length).toBeGreaterThan(0);
    expect(isPdf(r!.buffer)).toBe(true);
  });

  it('OQ-6: meeting rỗng (no participants) → vẫn xuất PDF', async () => {
    queryMock.getMeetingPresence.mockResolvedValue(summary([]));
    const r = await service.buildMeetingReport('m1', ADMIN_CALLER);
    expect(isPdf(r!.buffer)).toBe(true);
  });

  it('OQ-6: mọi duration 0 → vẫn xuất (Chưa có dữ liệu)', async () => {
    queryMock.getMeetingPresence.mockResolvedValue(
      summary([
        {
          userId: 'u1',
          fullName: 'Bob',
          durationMs: 0,
          method: 'approx',
          presentRatio: 0,
          segmentCount: 0,
          unmatchedCount: 0,
        },
      ]),
    );
    const r = await service.buildMeetingReport('m1', ADMIN_CALLER);
    expect(isPdf(r!.buffer)).toBe(true);
  });

  it('meeting không tồn tại (getMeetingPresence null) → null', async () => {
    queryMock.getMeetingPresence.mockResolvedValue(null);
    expect(await service.buildMeetingReport('m1', ADMIN_CALLER)).toBeNull();
  });

  it('B3: meeting_code ký tự lạ → filename sanitized (chống header injection)', async () => {
    dsMock.manager.query.mockResolvedValue([
      { ...HEADER[0], meeting_code: 'MTG/001 #x"y' },
    ]);
    queryMock.getMeetingPresence.mockResolvedValue(summary([]));
    const r = await service.buildMeetingReport('m1', ADMIN_CALLER);
    expect(r!.filename).not.toMatch(/[/#"' ]/);
    expect(r!.filename).toMatch(/^ivss-presence-MTG_001__x_y-\d{8}\.pdf$/);
  });

  it('header rỗng (no row) → filename fallback meetingId', async () => {
    dsMock.manager.query.mockResolvedValue([]);
    queryMock.getMeetingPresence.mockResolvedValue(summary([]));
    const r = await service.buildMeetingReport('abc-123-def', ADMIN_CALLER);
    expect(r!.filename).toMatch(/^ivss-presence-abc-123-def-\d{8}\.pdf$/);
  });

  it('nhiều participant (page break) + duration đa dạng → vẫn ra PDF', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      userId: 'u' + i,
      fullName: 'User ' + i,
      durationMs: 1000 * (i + 1),
      method: i % 2 ? 'interval' : 'approx',
      presentRatio: i / 100,
      segmentCount: i,
      unmatchedCount: 0,
    }));
    queryMock.getMeetingPresence.mockResolvedValue(summary(many, 3));
    const r = await service.buildMeetingReport('m1', ADMIN_CALLER);
    expect(isPdf(r!.buffer)).toBe(true);
  });

  it('header start_time rác → fmtTime "—", vẫn ra PDF', async () => {
    dsMock.manager.query.mockResolvedValue([
      { ...HEADER[0], start_time: 'not-a-date' },
    ]);
    queryMock.getMeetingPresence.mockResolvedValue(summary([]));
    const r = await service.buildMeetingReport('m1', ADMIN_CALLER);
    expect(isPdf(r!.buffer)).toBe(true);
  });

  it('presentRatio non-finite → fmtRatio 0%, vẫn ra PDF', async () => {
    queryMock.getMeetingPresence.mockResolvedValue(
      summary([
        {
          userId: 'u1',
          fullName: 'Carol',
          durationMs: 1000,
          method: 'approx',
          presentRatio: Infinity,
          segmentCount: 1,
          unmatchedCount: 0,
        },
      ]),
    );
    const r = await service.buildMeetingReport('m1', ADMIN_CALLER);
    expect(isPdf(r!.buffer)).toBe(true);
  });

  it('SEC-01: dữ liệu nguồn không có imageBase64 (shape không chứa)', () => {
    expect(
      JSON.stringify(summary([{ fullName: 'X', durationMs: 1 }])),
    ).not.toContain('imageBase64');
  });

  // [FIX 2026-08-13] Report PDF: EMPLOYEE bị chặn hẳn (khác JSON endpoint chỉ lọc).
  describe('scope-check (FIX 2026-08-13)', () => {
    it('Employee gọi route report → 403, KHÔNG gọi getMeetingPresence/render PDF', async () => {
      queryMock.resolveScope.mockResolvedValue({
        viewerRole: 'EMPLOYEE',
        isUnrestricted: false,
        scopeDepartmentIds: null,
        selfUserId: 'emp-1',
      });
      await expect(service.buildMeetingReport('m1', 'emp-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(queryMock.getMeetingPresence).not.toHaveBeenCalled();
    });

    it('Manager → getMeetingPresence() được gọi kèm đúng callerId (để tự lọc scope)', async () => {
      queryMock.resolveScope.mockResolvedValue({
        viewerRole: 'MANAGER',
        isUnrestricted: false,
        scopeDepartmentIds: ['dept-1'],
        selfUserId: null,
      });
      queryMock.getMeetingPresence.mockResolvedValue(summary([]));
      await service.buildMeetingReport('m1', 'mgr-1');
      expect(queryMock.getMeetingPresence).toHaveBeenCalledWith('m1', 'mgr-1');
    });
  });
});
