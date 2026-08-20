/* eslint-disable @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { MeetingsService } from '../services/meetings.service.js';
import { MeetingEntity, MeetingStatus } from '../entities/meeting.entity.js';
import {
  MeetingAgendaEntity,
  AgendaStatus,
} from '../entities/meeting-agenda.entity.js';
import { MeetingParticipantEntity } from '../entities/meeting-participant.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { WarningTokenUtil } from '../utils/warning-token.util.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { UpdateAgendaItemDto } from '../dto/update-agenda-item.dto.js';
import { FaceProvisioningService } from '../../face-access/services/face-provisioning.service.js';
import { GuestInviteService } from '../../guest-access/services/guest-invite.service.js';
import { GuestEmailService } from '../../guest-access/services/guest-email.service.js';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../../storage/storage.service.js';

describe('MeetingsService.updateAgendaItem', () => {
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

  let currentItem: MeetingAgendaEntity;
  let allItems: MeetingAgendaEntity[];
  let meetingStatus: MeetingStatus;
  let participantIds: string[];

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
    const faceProvisioningService = {
      deprovisionMeeting: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<FaceProvisioningService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingsService,
        { provide: DataSource, useValue: dataSource },
        { provide: WarningTokenUtil, useValue: warningTokenUtil },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuthzReadRepository, useValue: authzRepo },
        { provide: FaceProvisioningService, useValue: faceProvisioningService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-secret') },
        },
        {
          provide: StorageService,
          useValue: {
            saveFile: jest.fn(),
            deleteFile: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: GuestInviteService,
          useValue: { revokeAllForMeeting: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: GuestEmailService,
          useValue: { sendInviteLink: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<MeetingsService>(MeetingsService);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    currentItem = makeAgendaItem();
    allItems = [currentItem];
    meetingStatus = MeetingStatus.SCHEDULED;
    participantIds = ['participant-1'];

    (dataSource.transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb(em),
    );

    (dataSource.getRepository as jest.Mock).mockImplementation(
      (entity: any) => {
        if (entity === MeetingParticipantEntity) {
          return {
            find: jest
              .fn()
              .mockResolvedValue(
                participantIds.map((userId) => ({ meetingId, userId })),
              ),
          };
        }
        return {
          findOne: jest.fn().mockResolvedValue(null),
          find: jest.fn().mockResolvedValue([]),
        };
      },
    );

    (em.findOne as jest.Mock).mockImplementation(
      (entity: any, options: any) => {
        if (entity === MeetingEntity) {
          return Promise.resolve({ ...mockMeeting, status: meetingStatus });
        }
        if (entity === MeetingAgendaEntity) {
          const id = options?.where?.id;
          const item = allItems.find((i) => i.id === id);
          return Promise.resolve(item ?? null);
        }
        if (entity === UserEntity) {
          const id = options?.where?.id;
          return Promise.resolve({ id, fullName: 'Nguyen Van A' });
        }
        return Promise.resolve(null);
      },
    );

    (em.find as jest.Mock).mockImplementation((entity: any) => {
      if (entity === MeetingAgendaEntity) {
        return Promise.resolve([...allItems]);
      }
      return Promise.resolve([]);
    });

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

  it('[AC-001] updates only the title when only title is provided', async () => {
    const dto: UpdateAgendaItemDto = { title: 'New title' };

    const result = await service.updateAgendaItem(
      meetingId,
      currentItem.id,
      dto,
      organizerId,
    );

    expect(result.title).toBe('New title');
    expect(result.plannedDurationMinutes).toBe(20);
    expect(em.update).toHaveBeenCalledWith(
      MeetingAgendaEntity,
      { id: currentItem.id },
      expect.objectContaining({ title: 'New title', updatedBy: organizerId }),
    );
    expect(em.save).toHaveBeenCalledWith(
      AuditLogEntity,
      expect.objectContaining({ actionType: 'agenda_item_updated' }),
    );
  });

  it('updates plannedDurationMinutes without overflow', async () => {
    const dto: UpdateAgendaItemDto = { plannedDurationMinutes: 45 };

    const result = await service.updateAgendaItem(
      meetingId,
      currentItem.id,
      dto,
      organizerId,
    );

    expect(result.plannedDurationMinutes).toBe(45);
    expect(result.totalPlannedDurationMinutes).toBe(45);
    expect(result.remainingDurationMinutes).toBe(15);
  });

  it('updates ownerId and resolves ownerName', async () => {
    const dto: UpdateAgendaItemDto = { ownerId: 'participant-1' };

    const result = await service.updateAgendaItem(
      meetingId,
      currentItem.id,
      dto,
      organizerId,
    );

    expect(result.ownerId).toBe('participant-1');
    expect(result.ownerName).toBe('Nguyen Van A');
  });

  it('[AC-... ] un-assigns owner when ownerId is explicitly null', async () => {
    currentItem.ownerId = 'participant-1';
    const dto: UpdateAgendaItemDto = { ownerId: null };

    const result = await service.updateAgendaItem(
      meetingId,
      currentItem.id,
      dto,
      organizerId,
    );

    expect(result.ownerId).toBeNull();
    expect(result.ownerName).toBeNull();
  });

  it('[AC-002] moves an item to an earlier position and shifts the others', async () => {
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

    const dto: UpdateAgendaItemDto = { agendaOrder: 1 };

    const result = await service.updateAgendaItem(
      meetingId,
      item3.id,
      dto,
      organizerId,
    );

    expect(result.agendaOrder).toBe(1);
    expect(item1.agendaOrder).toBe(2);
    expect(item2.agendaOrder).toBe(3);
    expect(item3.agendaOrder).toBe(1);
  });

  it('moves an item to a later position and shifts the others', async () => {
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

    const dto: UpdateAgendaItemDto = { agendaOrder: 3 };

    const result = await service.updateAgendaItem(
      meetingId,
      item1.id,
      dto,
      organizerId,
    );

    expect(result.agendaOrder).toBe(3);
    expect(item2.agendaOrder).toBe(1);
    expect(item3.agendaOrder).toBe(2);
    expect(item1.agendaOrder).toBe(3);
  });

  it('updates multiple fields at once', async () => {
    const dto: UpdateAgendaItemDto = {
      title: 'Combined update',
      plannedDurationMinutes: 30,
      ownerId: 'participant-1',
    };

    const result = await service.updateAgendaItem(
      meetingId,
      currentItem.id,
      dto,
      organizerId,
    );

    expect(result.title).toBe('Combined update');
    expect(result.plannedDurationMinutes).toBe(30);
    expect(result.ownerId).toBe('participant-1');
  });

  it('[AC-010] rejects ownerId not in meeting participants', async () => {
    const dto: UpdateAgendaItemDto = { ownerId: 'stranger-1' };

    await expect(
      service.updateAgendaItem(meetingId, currentItem.id, dto, organizerId),
    ).rejects.toMatchObject({
      message: 'AGENDA_OWNER_NOT_PARTICIPANT',
    });
    await expect(
      service.updateAgendaItem(meetingId, currentItem.id, dto, organizerId),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects an empty title after trim', async () => {
    const dto: UpdateAgendaItemDto = { title: '   ' };

    await expect(
      service.updateAgendaItem(meetingId, currentItem.id, dto, organizerId),
    ).rejects.toMatchObject({ message: 'AGENDA_TITLE_REQUIRED' });
  });

  it('rejects a title longer than 255 characters', async () => {
    const dto: UpdateAgendaItemDto = { title: 'a'.repeat(256) };

    await expect(
      service.updateAgendaItem(meetingId, currentItem.id, dto, organizerId),
    ).rejects.toMatchObject({ message: 'AGENDA_TITLE_TOO_LONG' });
  });

  it('rejects a description longer than 2000 characters', async () => {
    const dto: UpdateAgendaItemDto = { description: 'a'.repeat(2001) };

    await expect(
      service.updateAgendaItem(meetingId, currentItem.id, dto, organizerId),
    ).rejects.toMatchObject({ message: 'AGENDA_DESCRIPTION_TOO_LONG' });
  });

  it('[AC-009] rejects an update that causes duration overflow', async () => {
    const other = makeAgendaItem({
      id: 'agenda-2',
      agendaOrder: 2,
      plannedDurationMinutes: 30,
    });
    allItems = [currentItem, other];

    const dto: UpdateAgendaItemDto = { plannedDurationMinutes: 50 }; // 50 + 30 = 80 > 60

    await expect(
      service.updateAgendaItem(meetingId, currentItem.id, dto, organizerId),
    ).rejects.toMatchObject({ message: 'AGENDA_DURATION_OVERFLOW' });
  });

  it('rejects an agendaOrder outside the valid range', async () => {
    const dto: UpdateAgendaItemDto = { agendaOrder: 99 };

    await expect(
      service.updateAgendaItem(meetingId, currentItem.id, dto, organizerId),
    ).rejects.toMatchObject({ message: 'AGENDA_INVALID_ORDER' });
  });

  it('[AC-011] rejects an empty request body', async () => {
    const dto: UpdateAgendaItemDto = {};

    await expect(
      service.updateAgendaItem(meetingId, currentItem.id, dto, organizerId),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateAgendaItem(meetingId, currentItem.id, dto, organizerId),
    ).rejects.toMatchObject({ message: 'AGENDA_UPDATE_PAYLOAD_EMPTY' });
  });

  it('[AC-006] rejects an unknown agendaId', async () => {
    const dto: UpdateAgendaItemDto = { title: 'Does not matter' };

    await expect(
      service.updateAgendaItem(meetingId, 'nonexistent', dto, organizerId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateAgendaItem(meetingId, 'nonexistent', dto, organizerId),
    ).rejects.toMatchObject({ message: 'AGENDA_ITEM_NOT_FOUND' });
  });

  it('[AC-008] rejects when the meeting is not scheduled', async () => {
    meetingStatus = MeetingStatus.COMPLETED;
    const dto: UpdateAgendaItemDto = { title: 'Should be blocked' };

    await expect(
      service.updateAgendaItem(meetingId, currentItem.id, dto, organizerId),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.updateAgendaItem(meetingId, currentItem.id, dto, organizerId),
    ).rejects.toMatchObject({ message: 'AGENDA_MEETING_STATUS_BLOCKED' });
  });

  it('allows update when the meeting is pending_approval', async () => {
    meetingStatus = MeetingStatus.PENDING_APPROVAL;
    const dto: UpdateAgendaItemDto = { title: 'Updated while pending' };

    const result = await service.updateAgendaItem(
      meetingId,
      currentItem.id,
      dto,
      organizerId,
    );

    expect(result.title).toBe('Updated while pending');
  });

  it('[AC-004] rejects a regular participant (not organizer/host/admin)', async () => {
    const dto: UpdateAgendaItemDto = { title: 'Should be forbidden' };

    await expect(
      service.updateAgendaItem(
        meetingId,
        currentItem.id,
        dto,
        'random-participant',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.updateAgendaItem(
        meetingId,
        currentItem.id,
        dto,
        'random-participant',
      ),
    ).rejects.toMatchObject({ message: 'AGENDA_WRITE_FORBIDDEN' });
  });

  it('[AC-013] treats an identical payload as a no-op (no mutation, no audit log)', async () => {
    const dto: UpdateAgendaItemDto = { title: currentItem.title };

    const result = await service.updateAgendaItem(
      meetingId,
      currentItem.id,
      dto,
      organizerId,
    );

    expect(result.title).toBe(currentItem.title);
    expect(em.update).not.toHaveBeenCalled();
    expect(em.save).not.toHaveBeenCalled();
  });

  it('[AC-015] does not persist changes when the transaction fails', async () => {
    (em.update as jest.Mock).mockRejectedValueOnce(new Error('DB error'));
    const dto: UpdateAgendaItemDto = { title: 'Should not persist' };

    await expect(
      service.updateAgendaItem(meetingId, currentItem.id, dto, organizerId),
    ).rejects.toThrow('DB error');
    expect(currentItem.title).toBe('Original title');
  });
});
