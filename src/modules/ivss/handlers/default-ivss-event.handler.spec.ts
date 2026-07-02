/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Logger } from '@nestjs/common';
import { DefaultIvssEventHandler } from './default-ivss-event.handler.js';

describe('DefaultIvssEventHandler (IVS-001 #36, OQ-3=A)', () => {
  let handler: DefaultIvssEventHandler;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    handler = new DefaultIvssEventHandler();
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => logSpy.mockRestore());

  it('onFaceEvent resolves + log metadata (KHÔNG imageBase64) — SEC-01', async () => {
    await expect(
      handler.onFaceEvent({
        type: 'face_recognized',
        channelId: 3,
        personUid: 'p1',
        utc: '2026-06-22T09:00:00Z',
        imageBase64: 'data:image/jpeg;base64,SECRETLONGBASE64DATA==',
      }),
    ).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = String(logSpy.mock.calls[0][0]);
    expect(logged).toContain('person=p1');
    expect(logged).toContain('channel=3');
    // SEC-01: KHÔNG lộ base64.
    expect(logged).not.toContain('base64');
    expect(logged).not.toContain('SECRETLONGBASE64DATA');
  });
});
