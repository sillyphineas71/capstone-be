import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MeetingUpdateService } from './meeting-update.service.js';
import { MeetingStatus } from '../entities/meeting.entity.js';
import { UpdateMeetingDto } from '../dto/update-meeting.dto.js';

describe('MeetingUpdateService.update (BE-03)', () => {
  function makeMeeting(overrides: Record<string, unknown> = {}) {
    return {
      id: 'meeting-1',
      title: 'Old title',
      description: 'Old description',
      organizerId: 'organizer-1',
      hostId: 'host-1',
      status: MeetingStatus.SCHEDULED,
      deletedAt: null,
      ...overrides,
    };
  }

  function setup(meeting: unknown = makeMeeting()) {
    const findOne = jest.fn().mockResolvedValue(meeting);
    const repo = { findOne };
    const emQuery = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('SELECT updated_at')) {
        return Promise.resolve([
          { updated_at: new Date('2026-07-27T00:00:00Z') },
        ]);
      }
      return Promise.resolve([]);
    });
    const em = { query: emQuery };
    const transaction = jest
      .fn()
      .mockImplementation((cb: (em: unknown) => unknown) => cb(em));

    const dataSource = {
      getRepository: jest.fn(() => repo),
      transaction,
    } as unknown as import('typeorm').DataSource;

    const service = new MeetingUpdateService(dataSource);
    return { service, findOne, emQuery, transaction };
  }

  const authUser = { userId: 'organizer-1' };

  it('cap nhat thanh cong khi chi gui title (giu nguyen description)', async () => {
    const { service, emQuery } = setup();
    const dto: UpdateMeetingDto = { title: 'New title' };

    const result = await service.update('meeting-1', dto, authUser);

    expect(result.title).toBe('New title');
    expect(result.description).toBe('Old description');
    const updateCall = emQuery.mock.calls.find((c) =>
      (c[0] as string).includes('UPDATE meetings'),
    );
    expect(updateCall![1]).toEqual([
      'New title',
      'Old description',
      'organizer-1',
      'meeting-1',
    ]);
  });

  it('cap nhat thanh cong khi chi gui description (giu nguyen title)', async () => {
    const { service } = setup();
    const result = await service.update(
      'meeting-1',
      { description: 'New description' },
      authUser,
    );
    expect(result.title).toBe('Old title');
    expect(result.description).toBe('New description');
  });

  it('ghi meeting_events voi event_type metadata_updated', async () => {
    const { service, emQuery } = setup();
    await service.update('meeting-1', { title: 'X' }, authUser);
    const eventCall = emQuery.mock.calls.find((c) =>
      (c[0] as string).includes('INSERT INTO meeting_events'),
    );
    expect(eventCall![1]).toEqual(
      expect.arrayContaining(['meeting-1', 'metadata_updated', 'organizer-1']),
    );
  });

  it('host (khong phai organizer) van co quyen sua', async () => {
    const { service } = setup();
    const result = await service.update(
      'meeting-1',
      { title: 'By host' },
      { userId: 'host-1' },
    );
    expect(result.title).toBe('By host');
  });

  it('body rong (khong title, khong description) → 400 EMPTY_UPDATE_PAYLOAD', async () => {
    const { service, findOne } = setup();
    await expect(
      service.update('meeting-1', {}, authUser),
    ).rejects.toThrow(BadRequestException);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('meeting khong ton tai → 404 MEETING_NOT_FOUND', async () => {
    const { service } = setup(null);
    await expect(
      service.update('meeting-1', { title: 'x' }, authUser),
    ).rejects.toThrow(NotFoundException);
  });

  it('meeting da bi xoa mem (deletedAt set) → 404 MEETING_NOT_FOUND', async () => {
    const { service } = setup(makeMeeting({ deletedAt: new Date() }));
    await expect(
      service.update('meeting-1', { title: 'x' }, authUser),
    ).rejects.toThrow(NotFoundException);
  });

  it('khong phai organizer/host → 403 FORBIDDEN', async () => {
    const { service } = setup();
    await expect(
      service.update('meeting-1', { title: 'x' }, { userId: 'someone-else' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('meeting da huy (cancelled) → 409 INVALID_MEETING_STATUS', async () => {
    const { service } = setup(makeMeeting({ status: MeetingStatus.CANCELLED }));
    await expect(
      service.update('meeting-1', { title: 'x' }, authUser),
    ).rejects.toThrow(ConflictException);
  });

  it('meeting da ket thuc (completed) → 409 INVALID_MEETING_STATUS', async () => {
    const { service } = setup(makeMeeting({ status: MeetingStatus.COMPLETED }));
    await expect(
      service.update('meeting-1', { title: 'x' }, authUser),
    ).rejects.toThrow(ConflictException);
  });
});
