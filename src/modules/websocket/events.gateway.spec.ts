/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { ConfigService } from '@nestjs/config';
import { EventsGateway } from './events.gateway.js';

const MEETING_UUID = '22222222-2222-2222-2222-222222222222';

describe('EventsGateway — IRP-001 (#40) subscribe per-meeting', () => {
  let gateway: EventsGateway;
  let client: { join: jest.Mock; leave: jest.Mock };

  beforeEach(() => {
    const config = { get: (_k: string, def: unknown) => def } as ConfigService;
    gateway = new EventsGateway(config);
    client = { join: jest.fn(), leave: jest.fn() };
  });

  it('ivss:subscribe meetingId hợp lệ → client.join(ivss:meeting:<id>) + ack', () => {
    const ack = gateway.handleIvssSubscribe(
      { meetingId: MEETING_UUID },
      client as any,
    );
    expect(client.join).toHaveBeenCalledWith(`ivss:meeting:${MEETING_UUID}`);
    expect(ack).toEqual({ ok: true, room: `ivss:meeting:${MEETING_UUID}` });
  });

  it('ivss:unsubscribe meetingId hợp lệ → client.leave(room) + ack', () => {
    const ack = gateway.handleIvssUnsubscribe(
      { meetingId: MEETING_UUID },
      client as any,
    );
    expect(client.leave).toHaveBeenCalledWith(`ivss:meeting:${MEETING_UUID}`);
    expect(ack).toEqual({ ok: true, room: `ivss:meeting:${MEETING_UUID}` });
  });

  it('subscribe meetingId KHÔNG phải uuid → no-op (KHÔNG join) + ack ok:false', () => {
    const ack = gateway.handleIvssSubscribe(
      { meetingId: 'not-a-uuid' },
      client as any,
    );
    expect(client.join).not.toHaveBeenCalled();
    expect(ack).toEqual({ ok: false });
  });

  it('subscribe thiếu meetingId → no-op', () => {
    const ack = gateway.handleIvssSubscribe({}, client as any);
    expect(client.join).not.toHaveBeenCalled();
    expect(ack).toEqual({ ok: false });
  });

  it('unsubscribe meetingId rác → no-op', () => {
    const ack = gateway.handleIvssUnsubscribe(
      { meetingId: '../../x' },
      client as any,
    );
    expect(client.leave).not.toHaveBeenCalled();
    expect(ack).toEqual({ ok: false });
  });
});
