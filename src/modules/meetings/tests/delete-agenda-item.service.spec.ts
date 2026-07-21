/* eslint-disable @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { MeetingsService } from '../services/meetings.service.js';
import { MeetingEntity, MeetingStatus } from '../entities/meeting.entity.js';
import {
  MeetingAgendaEntity,
  AgendaStatus,
} from '../entities/meeting-agenda.entity.js';
import { WarningTokenUtil } from '../utils/warning-token.util.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';

describe('MeetingsService.deleteAgendaItem', () => {
  let service: MeetingsService;
  let dataSource: jest.Mocked<DataSource>;
  let em: jest.Mocked<EntityManager>;

  const meetingId = 'meeting-1';
  const organizerId = 'organizer-1';

  const mockMeeting = {
    id: meetingId,
    status: MeetingStatus.SCHEDULED,
    organizerId,
    hostId: null,
    deletedAt: null,
    startTime: new Date('2026-07-01T09:00:00Z'),
    endTime: new Date('2026-07-01T10:00:00Z'), // 60 minutes
  } as MeetingEntity;

  function makeAgendaItem(
    overrides: Partial<MeetingAgendaEntity> = {},
  ): MeetingAgendaEntity {
    return {
      id: 'agenda-1',
      meetingId,
      agendaOrder: 1,
      title: 'Original title',
      description: 'Original description',
      ownerId: null,
      plannedDurationMinutes: 20,
      actualDurationMinutes: null,
      resultNote: null,
      status: AgendaStatus.PLANNED,
      createdBy: organizerId,
      updatedBy: organizerId,
      createdAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: new Date('2026-06-01T00:00:00Z'),
      owner: null,
      ...overrides,
    } as MeetingAgendaEntity;
  }

  let allItems: MeetingAgendaEntity[];
  let meetingStatus: MeetingStatus;

  beforeAll(async () => {
    em = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>;

    dataSource = {
      getRepository: jest.fn(),
      transaction: jest
        .fn()
        .mockImplementation(async (cb: (em: EntityManager) => Promise<any>) =>
          cb(em),
        ),
      manager: {} as EntityManager,
    } as unknown as jest.Mocked<DataSource>;

    const warningTokenUtil = {} as unknown as jest.Mocked<WarningTokenUtil>;
    const notificationsService =
      {} as unknown as jest.Mocked<NotificationsService>;
    const authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: [], permissions: [] }),
    } as unknown as jest.Mocked<AuthzReadRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingsService,
        { provide: DataSource, useValue: dataSource },
        { provide: WarningTokenUtil, useValue: warningTokenUtil },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuthzReadRepository, useValue: authzRepo },
      ],
    }).compile();

    service = module.get<MeetingsService>(MeetingsService);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    allItems = [makeAgendaItem()];
    meetingStatus = MeetingStatus.SCHEDULED;

    (dataSource.transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb(em),
    );

    (em.findOne as jest.Mock).mockImplementation(
      (entity: any, options: any) => {
        if (entity === MeetingEntity) {
          return Promise.resolve({ ...mockMeeting, status: meetingStatus });
        }
        if (entity === MeetingAgendaEntity) {
          const id = options?.where?.id;
          const mId = options?.where?.meetingId;
          const item = allItems.find(
            (i) => i.id === id && (mId === undefined || i.meetingId === mId),
          );
          return Promise.resolve(item ?? null);
        }
        return Promise.resolve(null);
      },
    );

    (em.find as jest.Mock).mockImplementation((entity: any, options: any) => {
      if (entity === MeetingAgendaEntity) {
        const minOrder = options?.where?.agendaOrder?._value;
        const mId = options?.where?.meetingId;
        if (minOrder !== undefined) {
          // MoreThan(deletedOrder) mock: filter by meetingId + agendaOrder > minOrder
          return Promise.resolve(
            allItems.filter(
              (i) =>
                i.agendaOrder > minOrder &&
                (mId === undefined || i.meetingId === mId),
            ),
          );
        }
        return Promise.resolve(
          mId === undefined
            ? [...allItems]
            : allItems.filter((i) => i.meetingId === mId),
        );
      }
      return Promise.resolve([]);
    });

    (em.delete as jest.Mock).mockImplementation(
      (entity: any, criteria: any) => {
        if (entity === MeetingAgendaEntity) {
          const idx = allItems.findIndex((i) => i.id === criteria.id);
          if (idx !== -1) {
            allItems.splice(idx, 1);
          }
        }
        return Promise.resolve({ affected: 1 });
      },
    );

    (em.update as jest.Mock).mockImplementation(
      (entity: any, criteria: any, partial: any) => {
        if (entity === MeetingAgendaEntity) {
          const target = allItems.find((i) => i.id === criteria.id);
          if (target) {
            Object.assign(target, partial);
          }
        }
        return Promise.resolve({ affected: 1 });
      },
    );

    (em.create as jest.Mock).mockImplementation(
      (_entity: any, data: any) => data,
    );
    (em.save as jest.Mock).mockImplementation((_entity: any, data: any) =>
      Promise.resolve(data),
    );
  });

  it('[TC-01] deletes an item in the middle of the list and renormalizes the ones after it', async () => {
    const item1 = makeAgendaItem({
      id: 'agenda-1',
      agendaOrder: 1,
      plannedDurationMinutes: 10,
    });
    const item2 = makeAgendaItem({
      id: 'agenda-2',
      agendaOrder: 2,
      plannedDurationMinutes: 10,
    });
    const item3 = makeAgendaItem({
      id: 'agenda-3',
      agendaOrder: 3,
      plannedDurationMinutes: 10,
    });
    allItems = [item1, item2, item3];

    const result = await service.deleteAgendaItem(
      meetingId,
      item2.id,
      organizerId,
    );

    expect(result.deleted).toBe(true);
    expect(result.agendaId).toBe('agenda-2');
    expect(allItems.map((i) => i.id)).toEqual(['agenda-1', 'agenda-3']);
    expect(item1.agendaOrder).toBe(1);
    expect(item3.agendaOrder).toBe(2);
    expect(result.remainingItemCount).toBe(2);
  });

  it('[TC-02] deletes the last item without renormalizing anything', async () => {
    const item1 = makeAgendaItem({
      id: 'agenda-1',
      agendaOrder: 1,
      plannedDurationMinutes: 10,
    });
    const item2 = makeAgendaItem({
      id: 'agenda-2',
      agendaOrder: 2,
      plannedDurationMinutes: 10,
    });
    allItems = [item1, item2];

    const result = await service.deleteAgendaItem(
      meetingId,
      item2.id,
      organizerId,
    );

    expect(result.deleted).toBe(true);
    expect(item1.agendaOrder).toBe(1);
    expect(result.remainingItemCount).toBe(1);
  });

  it('[TC-03] deletes the only remaining item, leaving the agenda empty', async () => {
    const only = makeAgendaItem({ id: 'agenda-1', agendaOrder: 1 });
    allItems = [only];

    const result = await service.deleteAgendaItem(
      meetingId,
      only.id,
      organizerId,
    );

    expect(result.deleted).toBe(true);
    expect(result.remainingItemCount).toBe(0);
    expect(result.totalPlannedDurationMinutes).toBe(0);
  });

  it('[AC-004] allows the organizer to delete', async () => {
    const item = allItems[0];
    const result = await service.deleteAgendaItem(
      meetingId,
      item.id,
      organizerId,
    );
    expect(result.deleted).toBe(true);
  });

  it('[TC-05] rejects a regular participant (not organizer/host/admin)', async () => {
    const item = allItems[0];

    await expect(
      service.deleteAgendaItem(meetingId, item.id, 'random-participant'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.deleteAgendaItem(meetingId, item.id, 'random-participant'),
    ).rejects.toMatchObject({ message: 'AGENDA_WRITE_FORBIDDEN' });
  });

  it('[TC-06] rejects an unknown agendaId', async () => {
    await expect(
      service.deleteAgendaItem(meetingId, 'nonexistent', organizerId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.deleteAgendaItem(meetingId, 'nonexistent', organizerId),
    ).rejects.toMatchObject({ message: 'AGENDA_ITEM_NOT_FOUND' });
  });

  it('[TC-07] rejects an agendaId belonging to a different meeting and leaves it untouched', async () => {
    const otherMeetingItem = makeAgendaItem({
      id: 'agenda-other',
      meetingId: 'meeting-2',
      agendaOrder: 1,
    });
    allItems = [makeAgendaItem(), otherMeetingItem];

    await expect(
      service.deleteAgendaItem(meetingId, otherMeetingItem.id, organizerId),
    ).rejects.toMatchObject({ message: 'AGENDA_ITEM_NOT_FOUND' });

    expect(allItems).toContainEqual(otherMeetingItem);
  });

  it('[TC-08] double DELETE on the same agendaId: first succeeds, second returns 404', async () => {
    const item = allItems[0];

    const first = await service.deleteAgendaItem(
      meetingId,
      item.id,
      organizerId,
    );
    expect(first.deleted).toBe(true);

    await expect(
      service.deleteAgendaItem(meetingId, item.id, organizerId),
    ).rejects.toMatchObject({ message: 'AGENDA_ITEM_NOT_FOUND' });
  });

  it.each([
    MeetingStatus.COMPLETED,
    MeetingStatus.CANCELLED,
    MeetingStatus.IN_PROGRESS,
    MeetingStatus.PENDING_APPROVAL,
  ])('[TC-09] rejects delete when meeting status is %s', async (status) => {
    meetingStatus = status;
    const item = allItems[0];

    await expect(
      service.deleteAgendaItem(meetingId, item.id, organizerId),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.deleteAgendaItem(meetingId, item.id, organizerId),
    ).rejects.toMatchObject({ message: 'AGENDA_MEETING_STATUS_BLOCKED' });
  });

  it('[TC-10] writes an audit log with a full snapshot and a null new value', async () => {
    const item = allItems[0];

    await service.deleteAgendaItem(meetingId, item.id, organizerId);

    expect(em.save).toHaveBeenCalledWith(
      AuditLogEntity,
      expect.objectContaining({
        actionType: 'agenda_item_deleted',
        entityType: 'meeting_agenda',
        entityId: item.id,
        newValueJson: null,
        oldValueJson: expect.objectContaining({
          id: item.id,
          title: item.title,
        }),
      }),
    );
  });

  it('[TC-11] does not persist the deletion when the transaction fails mid-way', async () => {
    const item = allItems[0];
    (em.delete as jest.Mock).mockRejectedValueOnce(new Error('DB error'));

    await expect(
      service.deleteAgendaItem(meetingId, item.id, organizerId),
    ).rejects.toThrow('DB error');

    expect(allItems).toContainEqual(item);
  });

  it('[TC-12] does not affect agenda_order of another meeting', async () => {
    const targetItem = makeAgendaItem({
      id: 'agenda-1',
      meetingId,
      agendaOrder: 1,
    });
    const otherMeetingItem = makeAgendaItem({
      id: 'agenda-other',
      meetingId: 'meeting-2',
      agendaOrder: 2,
    });
    allItems = [targetItem, otherMeetingItem];

    await service.deleteAgendaItem(meetingId, targetItem.id, organizerId);

    expect(otherMeetingItem.agendaOrder).toBe(2);
  });
});
