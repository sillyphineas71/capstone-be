/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method */
import { IvssInternalTokenGuard } from '../guards/ivss-internal-token.guard.js';
import { IvssWebhookController } from './ivss-webhook.controller.js';

describe('IvssWebhookController (IVS-001 #36)', () => {
  let controller: IvssWebhookController;
  let handlerMock: any;

  const dto = (over: any = {}) => ({
    type: 'face_recognized',
    channelId: 3,
    personUid: 'p1',
    utc: '2026-06-22T09:00:00Z',
    ...over,
  });

  beforeEach(() => {
    handlerMock = { onFaceEvent: jest.fn().mockResolvedValue(undefined) };
    controller = new IvssWebhookController(handlerMock);
  });

  it('body hợp lệ → handler gọi 1 lần + ack accepted:true', async () => {
    const r = await controller.receiveEvent(dto());
    expect(handlerMock.onFaceEvent).toHaveBeenCalledTimes(1);
    expect(r).toEqual({
      success: true,
      message: 'IVSS event accepted',
      data: { accepted: true },
    });
  });

  it('R2: handler throw → VẪN ack accepted:true (không vỡ)', async () => {
    handlerMock.onFaceEvent.mockRejectedValueOnce(new Error('boom'));
    const r = await controller.receiveEvent(dto());
    expect(r.data).toEqual({ accepted: true });
  });

  it('guard wiring: webhook có IvssInternalTokenGuard (SEC-02)', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.receiveEvent) ?? [];
    expect(guards).toContain(IvssInternalTokenGuard);
  });
});
