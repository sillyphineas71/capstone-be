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

describe('EventsGateway — feat-live-meeting-agenda-presentation', () => {
  let gateway: EventsGateway;
  let emitMock: jest.Mock;
  let toMock: jest.Mock;

  const AGENDA_UUID = '33333333-3333-3333-3333-333333333333';
  const FILE_UUID = '44444444-4444-4444-4444-444444444444';

  beforeEach(() => {
    const config = { get: (_k: string, def: unknown) => def } as ConfigService;
    gateway = new EventsGateway(config);
    emitMock = jest.fn();
    toMock = jest.fn().mockReturnValue({ emit: emitMock });
    gateway.server = { to: toMock } as unknown as EventsGateway['server'];
  });

  it('agenda:present hợp lệ → broadcast agenda:presented vào đúng room meeting:<id>', () => {
    const ack = gateway.handleAgendaPresent({
      meetingId: MEETING_UUID,
      agendaId: AGENDA_UUID,
      fileId: FILE_UUID,
      fileName: 'tai-lieu.pdf',
      presentedBy: 'user-1',
    });

    expect(ack).toEqual({ ok: true });
    expect(toMock).toHaveBeenCalledWith(`meeting:${MEETING_UUID}`);
    expect(emitMock).toHaveBeenCalledWith(
      'agenda:presented',
      expect.objectContaining({
        meetingId: MEETING_UUID,
        agendaId: AGENDA_UUID,
        fileId: FILE_UUID,
        fileName: 'tai-lieu.pdf',
        presentedBy: 'user-1',
      }),
    );
  });

  it('agenda:present thiếu fileId → no-op, không broadcast', () => {
    const ack = gateway.handleAgendaPresent({
      meetingId: MEETING_UUID,
      agendaId: AGENDA_UUID,
    });
    expect(ack).toEqual({ ok: false });
    expect(toMock).not.toHaveBeenCalled();
  });

  it('agenda:present meetingId không phải uuid → no-op', () => {
    const ack = gateway.handleAgendaPresent({
      meetingId: 'not-a-uuid',
      agendaId: AGENDA_UUID,
      fileId: FILE_UUID,
    });
    expect(ack).toEqual({ ok: false });
    expect(toMock).not.toHaveBeenCalled();
  });

  it('agenda:present_stop hợp lệ → broadcast agenda:present_stopped', () => {
    const ack = gateway.handleAgendaPresentStop({ meetingId: MEETING_UUID });
    expect(ack).toEqual({ ok: true });
    expect(toMock).toHaveBeenCalledWith(`meeting:${MEETING_UUID}`);
    expect(emitMock).toHaveBeenCalledWith('agenda:present_stopped', {
      meetingId: MEETING_UUID,
    });
  });

  it('agenda:present_stop meetingId rác → no-op', () => {
    const ack = gateway.handleAgendaPresentStop({ meetingId: 'x' });
    expect(ack).toEqual({ ok: false });
    expect(toMock).not.toHaveBeenCalled();
  });
});
