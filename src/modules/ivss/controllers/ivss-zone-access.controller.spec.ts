/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { IvssZoneAccessController } from './ivss-zone-access.controller.js';

const ZONE_ID = '097cf988-8976-42d9-a83d-e5a0013022d9';

describe('IvssZoneAccessController (Zone Access Log — đường B, FIX 2026-08-11)', () => {
  let controller: IvssZoneAccessController;
  let svc: any;

  const payload = {
    zoneId: ZONE_ID,
    zoneName: 'Hành lang tầng 2',
    date: '2026-07-28',
    totalEvents: 0,
    matchedCount: 0,
    unmatchedCount: 0,
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    events: [],
  };

  beforeEach(() => {
    svc = { getZoneAccessLog: jest.fn().mockResolvedValue(payload) };
    controller = new IvssZoneAccessController(svc);
  });

  it('accessLog: truyền zoneId từ param + đủ date/page/limit/search', async () => {
    const r = await controller.accessLog(ZONE_ID, {
      date: '2026-07-28',
      page: 2,
      limit: 50,
      search: 'Long',
    });
    expect(svc.getZoneAccessLog).toHaveBeenCalledWith(ZONE_ID, {
      date: '2026-07-28',
      page: 2,
      limit: 50,
      search: 'Long',
    });
    expect(r.success).toBe(true);
    expect(r.data).toBe(payload);
  });

  it('không truyền query optional → forward undefined cho service (mặc định do DTO lo)', async () => {
    await controller.accessLog(ZONE_ID, {});
    expect(svc.getZoneAccessLog).toHaveBeenCalledWith(ZONE_ID, {
      date: undefined,
      page: undefined,
      limit: undefined,
      search: undefined,
    });
  });

  it('lỗi từ service (vd 404 zone không tồn tại) trồi lên nguyên vẹn', async () => {
    const err = new Error('ZONE_NOT_FOUND');
    svc.getZoneAccessLog.mockRejectedValue(err);
    await expect(controller.accessLog(ZONE_ID, {})).rejects.toThrow(err);
  });
});
