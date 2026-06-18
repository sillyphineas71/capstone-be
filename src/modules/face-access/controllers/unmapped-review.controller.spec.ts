/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { UnmappedReviewController } from './unmapped-review.controller.js';

describe('UnmappedReviewController (UMR-001)', () => {
  let controller: UnmappedReviewController;
  let svc: any;

  beforeEach(() => {
    svc = {
      list: jest.fn().mockResolvedValue({
        data: [{ deviceId: 'dev1' }],
        meta: { page: 1, limit: 20 },
      }),
      map: jest.fn().mockResolvedValue({ mappingId: 'map1' }),
    };
    controller = new UnmappedReviewController(svc);
  });

  it('list: gọi service + bọc response success', async () => {
    const r = await controller.list({ page: 1, limit: 20 });
    expect(svc.list).toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.data).toEqual([{ deviceId: 'dev1' }]);
    expect(r.meta).toEqual({ page: 1, limit: 20 });
  });

  it('map: lấy adminId từ req.user (userId) + bọc response', async () => {
    const dto = {
      deviceId: 'dev1',
      personId: '70',
      userId: 'u1',
      meetingId: 'm1',
    };
    const r = await controller.map(dto, { user: { userId: 'admin1' } });
    expect(svc.map).toHaveBeenCalledWith(dto, 'admin1');
    expect(r.success).toBe(true);
  });

  it('map: adminId fallback sub/id → null khi thiếu', async () => {
    await controller.map({} as any, { user: { sub: 'admin2' } });
    expect(svc.map).toHaveBeenCalledWith({}, 'admin2');
    await controller.map({} as any, {});
    expect(svc.map).toHaveBeenCalledWith({}, null);
  });
});
