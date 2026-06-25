/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { StrangerAlertController } from './stranger-alert.controller.js';

describe('StrangerAlertController (SAL-001)', () => {
  let controller: StrangerAlertController;
  let svc: any;

  beforeEach(() => {
    svc = {
      list: jest.fn().mockResolvedValue({
        data: [{ deviceId: 'dev1' }],
        meta: { page: 1, limit: 20 },
      }),
    };
    controller = new StrangerAlertController(svc);
  });

  it('list: gọi service + bọc response success', async () => {
    const r = await controller.list({ page: 1, limit: 20 });
    expect(svc.list).toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.data).toEqual([{ deviceId: 'dev1' }]);
    expect(r.meta).toEqual({ page: 1, limit: 20 });
  });
});
