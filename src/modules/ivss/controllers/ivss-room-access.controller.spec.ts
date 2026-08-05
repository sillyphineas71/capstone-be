/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { IvssRoomAccessController } from './ivss-room-access.controller.js';

const ROOM_ID = '097cf988-8976-42d9-a83d-e5a0013022d9';

describe('IvssRoomAccessController (RAL-001 / ALS-002)', () => {
  let controller: IvssRoomAccessController;
  let svc: any;
  let snapshotSvc: any;

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
    snapshotSvc = { getSnapshot: jest.fn() };
    controller = new IvssRoomAccessController(svc, snapshotSvc);
  });

  it('accessLogAll: roomId=null + truyền đủ date/meetingId/page/limit/search', async () => {
    const MEETING_ID = '11111111-1111-4111-8111-111111111111';
    const r = await controller.accessLogAll({
      date: '2026-07-28',
      meetingId: MEETING_ID,
      page: 2,
      limit: 50,
      search: 'Long',
    });
    expect(svc.getRoomAccessLog).toHaveBeenCalledWith(null, {
      date: '2026-07-28',
      meetingId: MEETING_ID,
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
      meetingId: undefined,
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

  // ── F-F: GET /ivss/device-events/:eventId/snapshot ──
  describe('deviceEventSnapshot (F-F)', () => {
    const EVENT_ID = '22222222-2222-4222-8222-222222222222';
    const mkRes = () => ({ setHeader: jest.fn(), send: jest.fn() });

    it('trả về bytes ảnh + đúng Content-Type/Content-Disposition từ service', async () => {
      snapshotSvc.getSnapshot.mockResolvedValue({
        buffer: Buffer.from('IMG'),
        mimeType: 'image/jpeg',
        fileName: 'x.jpg',
      });
      const res = mkRes();
      await controller.deviceEventSnapshot(EVENT_ID, res as any);
      expect(snapshotSvc.getSnapshot).toHaveBeenCalledWith(EVENT_ID);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'inline; filename="x.jpg"',
      );
      expect(res.send).toHaveBeenCalledWith(Buffer.from('IMG'));
    });

    it('lỗi từ service (vd 404 không có snapshot) trồi lên nguyên vẹn', async () => {
      const err = new Error('DEVICE_EVENT_SNAPSHOT_NOT_FOUND');
      snapshotSvc.getSnapshot.mockRejectedValue(err);
      const res = mkRes();
      await expect(
        controller.deviceEventSnapshot(EVENT_ID, res as any),
      ).rejects.toThrow(err);
    });
  });
});
