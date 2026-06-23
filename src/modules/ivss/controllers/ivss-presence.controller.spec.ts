/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method */
import { NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { IvssPresenceController } from './ivss-presence.controller.js';

describe('IvssPresenceController (IPD-001 #41+#42)', () => {
  let controller: IvssPresenceController;
  let svc: any;

  beforeEach(() => {
    svc = { getUserPresence: jest.fn(), getMeetingPresence: jest.fn() };
    controller = new IvssPresenceController(svc);
  });

  it('userPresence → envelope {success,message,data}', async () => {
    svc.getUserPresence.mockResolvedValue({
      duration: { durationMs: 1, method: 'interval' },
      timeline: {},
    });
    const r = await controller.userPresence('m1', 'u1');
    expect(svc.getUserPresence).toHaveBeenCalledWith('m1', 'u1');
    expect(r.success).toBe(true);
    expect(r.data).toBeDefined();
  });

  it('userPresence: meeting không tồn tại → 404', async () => {
    svc.getUserPresence.mockResolvedValue(null);
    await expect(controller.userPresence('m1', 'u1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('meetingPresence → summary (C2 method mỗi dòng)', async () => {
    svc.getMeetingPresence.mockResolvedValue({
      participants: [{ userId: 'u1', method: 'interval', durationMs: 1 }],
      meetingUnmatchedIdentityCount: 0,
    });
    const r = await controller.meetingPresence('m1');
    expect(r.data.participants[0].method).toBe('interval');
  });

  it('meetingPresence: null → 404', async () => {
    svc.getMeetingPresence.mockResolvedValue(null);
    await expect(controller.meetingPresence('m1')).rejects.toThrow(
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
});
