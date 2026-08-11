import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { LiveMeetingService } from '../services/live-meeting.service.js';
import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import { MeetingEventEntity } from '../../meetings/entities/meeting-event.entity.js';
import { MeetingParticipantEntity } from '../../meetings/entities/meeting-participant.entity.js';
import { MeetingNoteEntity } from '../../meetings/entities/meeting-note.entity.js';
import { AttendanceEventEntity } from '../../attendance/entities/attendance-event.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';

/**
 * UC-99 — getMeetingTimeline: gộp 3 nguồn, quyền theo quan hệ, note-visibility.
 * KHÔNG stub resolveMeetingRole/buildVisibilityPredicate (chạy thật, mock DB bên dưới).
 */
describe('LiveMeetingService.getMeetingTimeline (UC-99)', () => {
  const meetingId = 'm-1';
  const hostId = 'host-1';
  const participantId = 'part-1';
  const outsiderId = 'out-1';

  // buildVisibilityPredicate dùng dynamic import() nội bộ (không chạy được dưới jest CJS).
  // Spy để: (1) tránh dynamic import; (2) mô phỏng áp visibility (andWhere) lên note qb;
  // (3) cho phép assert timeline CÓ GỌI visibility (T2). KHÔNG sửa source method.
  let visSpy: jest.SpyInstance;
  beforeEach(() => {
    visSpy = jest
      .spyOn(LiveMeetingService.prototype as any, 'buildVisibilityPredicate')
      .mockImplementation(async (...args: unknown[]) => {
        const q = args[0] as { andWhere: (s: string, p?: unknown) => unknown };
        q.andWhere('__visibility__ = :v', { v: true });
      });
  });
  afterEach(() => visSpy.mockRestore());

  function qb(getManyResult: unknown[]) {
    const o: any = {};
    for (const m of [
      'where',
      'andWhere',
      'select',
      'leftJoinAndSelect',
      'orderBy',
      'skip',
      'take',
    ]) {
      o[m] = jest.fn(() => o);
    }
    o.getMany = jest.fn().mockResolvedValue(getManyResult);
    o.getCount = jest.fn().mockResolvedValue(getManyResult.length);
    return o;
  }

  function setup(opts: {
    meeting?: unknown;
    participant?: unknown; // participant record của người gọi
    events?: unknown[];
    attendance?: unknown[];
    notes?: unknown[];
    actorUsers?: { id: string; fullName: string }[];
    visibilityParticipants?: { userId: string }[];
    currentUserDept?: string | null;
  }) {
    const noteQb = qb(opts.notes ?? []);
    const eventsQb = qb(opts.events ?? []);
    const attQb = qb(opts.attendance ?? []);
    const usersQb = qb(opts.actorUsers ?? []);
    const participantsQb = qb(opts.visibilityParticipants ?? []);

    const dataSource: any = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === MeetingEntity) {
          return {
            findOne: jest
              .fn()
              .mockResolvedValue(
                opts.meeting === undefined
                  ? { id: meetingId, hostId, deletedAt: null }
                  : opts.meeting,
              ),
          };
        }
        if (entity === MeetingParticipantEntity) {
          return {
            findOne: jest.fn().mockResolvedValue(opts.participant ?? null),
            createQueryBuilder: jest.fn(() => participantsQb),
          };
        }
        if (entity === UserEntity) {
          return {
            findOne: jest.fn().mockResolvedValue({
              id: 'x',
              departmentId: opts.currentUserDept ?? null,
            }),
            createQueryBuilder: jest.fn(() => usersQb),
          };
        }
        if (entity === MeetingEventEntity) {
          return { createQueryBuilder: jest.fn(() => eventsQb) };
        }
        if (entity === AttendanceEventEntity) {
          return { createQueryBuilder: jest.fn(() => attQb) };
        }
        if (entity === MeetingNoteEntity) {
          return { createQueryBuilder: jest.fn(() => noteQb) };
        }
        return {
          findOne: jest.fn(),
          createQueryBuilder: jest.fn(() => qb([])),
        };
      }),
    };

    const service = new LiveMeetingService(
      dataSource,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn((_k: string, d: unknown) => d) } as any,
      {} as any,
      {} as any,
    );
    return { service, noteQb, usersQb };
  }

  it('[T1] Gộp đủ 3 nguồn, sort theo time asc', async () => {
    const { service } = setup({
      participant: { participantRole: 'attendee' },
      events: [
        {
          id: 'e1',
          eventType: 'meeting_started',
          eventTime: new Date('2026-07-13T09:00:00Z'),
          actorUserId: hostId,
          description: 'start',
        },
      ],
      attendance: [
        {
          id: 'a1',
          eventType: 'check_in',
          eventTime: new Date('2026-07-13T09:05:00Z'),
          userId: participantId,
        },
      ],
      notes: [
        {
          id: 'n1',
          createdAt: new Date('2026-07-13T09:10:00Z'),
          authorId: participantId,
          content: 'note1',
        },
      ],
      actorUsers: [
        { id: hostId, fullName: 'Host' },
        { id: participantId, fullName: 'Part' },
      ],
    });

    const res = await service.getMeetingTimeline(meetingId, {}, participantId);

    expect(res.total).toBe(3);
    expect(res.data.map((i) => i.category)).toEqual([
      'meeting_event',
      'attendance',
      'note',
    ]);
    expect(res.data[0].time < res.data[1].time).toBe(true);
    expect(res.data[0].actorName).toBe('Host');
  });

  it('[T2] Note-visibility BẮT BUỘC — buildVisibilityPredicate được áp vào note query', async () => {
    const { service, noteQb } = setup({
      participant: { participantRole: 'attendee' },
      notes: [
        {
          id: 'n1',
          createdAt: new Date('2026-07-13T09:10:00Z'),
          authorId: 'other',
          content: 'x',
        },
      ],
    });

    await service.getMeetingTimeline(meetingId, {}, participantId);

    // Visibility predicate được GỌI với đúng note qb + meetingId + người gọi
    expect(visSpy).toHaveBeenCalledWith(noteQb, meetingId, participantId);
    // và nó áp andWhere lên note qb (không bỏ qua visibility)
    expect(noteQb.andWhere).toHaveBeenCalled();
  });

  it('[T3] Host xem OK (không 403)', async () => {
    const { service } = setup({
      meeting: { id: meetingId, hostId, deletedAt: null },
      participant: null, // host qua meeting.hostId
    });
    await expect(
      service.getMeetingTimeline(meetingId, {}, hostId),
    ).resolves.toBeDefined();
  });

  it('[T4] Participant xem OK (không 403)', async () => {
    const { service } = setup({
      participant: { participantRole: 'attendee' },
    });
    await expect(
      service.getMeetingTimeline(meetingId, {}, participantId),
    ).resolves.toBeDefined();
  });

  it('[T5] Người ngoài (không host/participant) → 403 NOT_A_MEETING_PARTICIPANT', async () => {
    const { service } = setup({
      meeting: { id: meetingId, hostId, deletedAt: null },
      participant: null,
    });
    await expect(
      service.getMeetingTimeline(meetingId, {}, outsiderId),
    ).rejects.toThrow(ForbiddenException);
  });

  it('[T6] Meeting không tồn tại → 404 MEETING_NOT_FOUND', async () => {
    const { service } = setup({ meeting: null });
    await expect(
      service.getMeetingTimeline(meetingId, {}, hostId),
    ).rejects.toThrow(NotFoundException);
  });

  it('[T7] from > to → 400 INVALID_DATE_RANGE', async () => {
    const { service } = setup({ participant: { participantRole: 'attendee' } });
    await expect(
      service.getMeetingTimeline(
        meetingId,
        { from: '2026-07-13T10:00:00Z', to: '2026-07-13T09:00:00Z' },
        participantId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('[T8] types filter — chỉ category được chọn', async () => {
    const { service } = setup({
      participant: { participantRole: 'attendee' },
      events: [
        {
          id: 'e1',
          eventType: 'meeting_started',
          eventTime: new Date('2026-07-13T09:00:00Z'),
          actorUserId: hostId,
          description: 's',
        },
      ],
      attendance: [
        {
          id: 'a1',
          eventType: 'check_in',
          eventTime: new Date('2026-07-13T09:05:00Z'),
          userId: participantId,
        },
      ],
      notes: [
        {
          id: 'n1',
          createdAt: new Date('2026-07-13T09:10:00Z'),
          authorId: participantId,
          content: 'x',
        },
      ],
      actorUsers: [{ id: hostId, fullName: 'Host' }],
    });
    const res = await service.getMeetingTimeline(
      meetingId,
      { types: 'meeting_event' },
      participantId,
    );
    expect(res.total).toBe(1);
    expect(res.data[0].category).toBe('meeting_event');
  });

  it('[T9] sort desc', async () => {
    const { service } = setup({
      participant: { participantRole: 'attendee' },
      events: [
        {
          id: 'e1',
          eventType: 'meeting_started',
          eventTime: new Date('2026-07-13T09:00:00Z'),
          actorUserId: hostId,
          description: 's',
        },
      ],
      attendance: [
        {
          id: 'a1',
          eventType: 'check_in',
          eventTime: new Date('2026-07-13T09:05:00Z'),
          userId: participantId,
        },
      ],
      actorUsers: [{ id: hostId, fullName: 'Host' }],
    });
    const res = await service.getMeetingTimeline(
      meetingId,
      { sort: 'desc' },
      participantId,
    );
    expect(res.data[0].time > res.data[1].time).toBe(true);
  });

  it('[T10] Phân trang + total đúng khi trộn nguồn', async () => {
    const events = Array.from({ length: 5 }, (_, k) => ({
      id: 'e' + k,
      eventType: 'meeting_started',
      eventTime: new Date(2026, 6, 13, 9, k),
      actorUserId: hostId,
      description: 's',
    }));
    const attendance = Array.from({ length: 3 }, (_, k) => ({
      id: 'a' + k,
      eventType: 'check_in',
      eventTime: new Date(2026, 6, 13, 10, k),
      userId: participantId,
    }));
    const { service } = setup({
      participant: { participantRole: 'attendee' },
      events,
      attendance,
      actorUsers: [{ id: hostId, fullName: 'Host' }],
    });
    const res = await service.getMeetingTimeline(
      meetingId,
      { page: 2, limit: 5 },
      participantId,
    );
    expect(res.total).toBe(8); // 5 + 3
    expect(res.data).toHaveLength(3); // trang 2 (item 6-8)
    expect(res.page).toBe(2);
    expect(res.limit).toBe(5);
  });

  it('[T11] Rỗng → data:[], total:0', async () => {
    const { service } = setup({ participant: { participantRole: 'attendee' } });
    const res = await service.getMeetingTimeline(meetingId, {}, participantId);
    expect(res.data).toEqual([]);
    expect(res.total).toBe(0);
  });

  it('[T12] actorName resolve BATCH 1 query (không N+1)', async () => {
    const { service, usersQb } = setup({
      participant: { participantRole: 'attendee' },
      events: [
        {
          id: 'e1',
          eventType: 'meeting_started',
          eventTime: new Date('2026-07-13T09:00:00Z'),
          actorUserId: hostId,
          description: 's',
        },
        {
          id: 'e2',
          eventType: 'meeting_ended',
          eventTime: new Date('2026-07-13T09:30:00Z'),
          actorUserId: participantId,
          description: 'e',
        },
      ],
      actorUsers: [
        { id: hostId, fullName: 'Host' },
        { id: participantId, fullName: 'Part' },
      ],
    });
    await service.getMeetingTimeline(meetingId, {}, participantId);
    expect(usersQb.getMany).toHaveBeenCalledTimes(1); // 1 query cho cả trang
  });
});
