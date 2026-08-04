/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { IvssRoomAccessController } from './ivss-room-access.controller.js';

const ROOM_ID = '097cf988-8976-42d9-a83d-e5a0013022d9';

describe('IvssRoomAccessController (RAL-001 / ALS-002)', () => {
  let controller: IvssRoomAccessController;
  let svc: any;

  const payload = {
    roomId: null,
    roomName: null,
    date: '2026-07-28',
    totalEvents: 0,
    matchedCount: 0,
    unmatchedCount: 0,
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    events: [],
  };

  beforeEach(() => {
    svc = { getRoomAccessLog: jest.fn().mockResolvedValue(payload) };
    controller = new IvssRoomAccessController(svc);
  });

  it('accessLogAll: roomId=null + truyền đủ date/page/limit/search', async () => {
    const r = await controller.accessLogAll({
      date: '2026-07-28',
      page: 2,
      limit: 50,
      search: 'Long',
    });
    expect(svc.getRoomAccessLog).toHaveBeenCalledWith(null, {
      date: '2026-07-28',
      page: 2,
      limit: 50,
      search: 'Long',
    });
    expect(r.success).toBe(true);
    expect(r.data).toBe(payload);
  });

  it('accessLog (1 phòng): truyền roomId từ param', async () => {
    const r = await controller.accessLog(ROOM_ID, {
      date: '2026-07-28',
      page: 1,
      limit: 20,
    });
    expect(svc.getRoomAccessLog).toHaveBeenCalledWith(ROOM_ID, {
      date: '2026-07-28',
      page: 1,
      limit: 20,
      search: undefined,
    });
    expect(r.success).toBe(true);
  });

  it('lỗi từ service (vd 404 phòng không tồn tại) trồi lên nguyên vẹn', async () => {
    const err = new Error('ROOM_NOT_FOUND');
    svc.getRoomAccessLog.mockRejectedValue(err);
    await expect(controller.accessLog(ROOM_ID, {})).rejects.toThrow(err);
  });
});
