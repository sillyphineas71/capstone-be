/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { IvssPresenceController } from './ivss-presence.controller.js';

// [FIX 2026-08-13] userPresence/meetingPresence/report giờ nhận thêm @CurrentUser().
const CALLER = { userId: 'caller-1' };

describe('IvssPresenceController (IPD-001 #41+#42 + IPR-001 #43)', () => {
  let controller: IvssPresenceController;
  let svc: any;
  let reportSvc: any;

  const resMock = () => {
    const res: any = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    res.setHeader = jest.fn(() => res);
    res.send = jest.fn(() => res);
    res.end = jest.fn(() => res);
    return res;
  };

  beforeEach(() => {
    svc = { getUserPresence: jest.fn(), getMeetingPresence: jest.fn() };
    reportSvc = { buildMeetingReport: jest.fn() };
    controller = new IvssPresenceController(svc, reportSvc);
  });

  it('userPresence → envelope {success,message,data}', async () => {
    svc.getUserPresence.mockResolvedValue({
      duration: { durationMs: 1, method: 'interval' },
      timeline: {},
    });
    const r = await controller.userPresence('m1', 'u1', CALLER);
    expect(svc.getUserPresence).toHaveBeenCalledWith('m1', 'u1', 'caller-1');
    expect(r.success).toBe(true);
    expect(r.data).toBeDefined();
  });

  it('userPresence: meeting không tồn tại → 404', async () => {
    svc.getUserPresence.mockResolvedValue(null);
    await expect(controller.userPresence('m1', 'u1', CALLER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('meetingPresence → summary (C2 method mỗi dòng)', async () => {
    svc.getMeetingPresence.mockResolvedValue({
      participants: [{ userId: 'u1', method: 'interval', durationMs: 1 }],
      meetingUnmatchedIdentityCount: 0,
    });
    const r = await controller.meetingPresence('m1', CALLER);
    expect(svc.getMeetingPresence).toHaveBeenCalledWith('m1', 'caller-1');
    expect(r.data.participants[0].method).toBe('interval');
  });

  it('meetingPresence: null → 404', async () => {
    svc.getMeetingPresence.mockResolvedValue(null);
    await expect(controller.meetingPresence('m1', CALLER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('guard wiring: JwtAuthGuard trên cả 2 route (SEC-02)', () => {
    const u = Reflect.getMetadata('__guards__', controller.userPresence) ?? [];
    const m =
      Reflect.getMetadata('__guards__', controller.meetingPresence) ?? [];
    expect(u).toContain(JwtAuthGuard);
    expect(m).toContain(JwtAuthGuard);
  });

  // ── #43 report (C2: @Res file, no envelope) ──
  it('report: buffer → Content-Type pdf + Content-Disposition attachment + send', async () => {
    const buf = Buffer.from('%PDF-1.7 fake');
    reportSvc.buildMeetingReport.mockResolvedValue({
      buffer: buf,
      filename: 'ivss-presence-MTG-001-20260623.pdf',
    });
    const res = resMock();
    await controller.report('m1', CALLER, res);
    expect(reportSvc.buildMeetingReport).toHaveBeenCalledWith('m1', 'caller-1');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/pdf',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="ivss-presence-MTG-001-20260623.pdf"',
    );
    expect(res.send).toHaveBeenCalledWith(buf);
  });

  it('report: meeting không tồn tại (null) → 404', async () => {
    reportSvc.buildMeetingReport.mockResolvedValue(null);
    const res = resMock();
    await controller.report('m1', CALLER, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).not.toHaveBeenCalled();
  });

  it('report: service throw (lỗi thường) → 500 .end() (KHÔNG lộ path, KHÔNG send)', async () => {
    reportSvc.buildMeetingReport.mockRejectedValue(
      new Error('/internal/path boom'),
    );
    const res = resMock();
    await controller.report('m1', CALLER, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.end).toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  // [FIX 2026-08-13] EMPLOYEE bị buildMeetingReport() ném ForbiddenException chủ đích —
  // PHẢI propagate đúng 403 (Nest exception filter), KHÔNG bị nuốt chung vào nhánh 500.
  it('report: EMPLOYEE bị chặn (ForbiddenException) → propagate đúng 403, KHÔNG rơi vào nhánh 500', async () => {
    reportSvc.buildMeetingReport.mockRejectedValue(
      new ForbiddenException({
        success: false,
        message: 'You do not have permission to view this report',
        error: { code: 'PERMISSION_DENIED', details: {} },
      }),
    );
    const res = resMock();
    await expect(controller.report('m1', CALLER, res)).rejects.toThrow(
      ForbiddenException,
    );
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.send).not.toHaveBeenCalled();
  });

  it('guard wiring: report route có JwtAuthGuard (SEC-02)', () => {
    const g = Reflect.getMetadata('__guards__', controller.report) ?? [];
    expect(g).toContain(JwtAuthGuard);
  });
});
