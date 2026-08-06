/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { IvssDeviceEventSnapshotController } from './ivss-device-event-snapshot.controller.js';

const EVENT_ID = '22222222-2222-4222-8222-222222222222';

describe('IvssDeviceEventSnapshotController (F-F fix)', () => {
  let controller: IvssDeviceEventSnapshotController;
  let snapshotSvc: any;

  const mkRes = () => ({ setHeader: jest.fn(), send: jest.fn() });

  beforeEach(() => {
    snapshotSvc = { getSnapshot: jest.fn() };
    controller = new IvssDeviceEventSnapshotController(snapshotSvc);
  });

  it('trả về bytes ảnh + đúng Content-Type/Content-Disposition từ service', async () => {
    snapshotSvc.getSnapshot.mockResolvedValue({
      buffer: Buffer.from('IMG'),
      mimeType: 'image/jpeg',
      fileName: 'x.jpg',
    });
    const res = mkRes();
    await controller.snapshot(EVENT_ID, res as any);
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
    await expect(controller.snapshot(EVENT_ID, res as any)).rejects.toThrow(
      err,
    );
  });
});
