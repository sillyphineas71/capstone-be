/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { DataSource } from 'typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { MinutesService } from './minutes.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { CreateDraftMinutesDto } from '../dto/create-draft-minutes.dto.js';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
  ParticipantAttendanceStatus,
} from '../../meetings/entities/meeting-participant.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
  MeetingMinutesVisibilityLevel,
} from '../entities/meeting-minutes.entity.js';

describe('MinutesService', () => {
  let service: MinutesService;
  let dataSource: { transaction: jest.Mock };
  let auditLogsService: { logAction: jest.Mock };
  let meetingQueryBuilder: {
    setLock: jest.Mock;
    where: jest.Mock;
    getOne: jest.Mock;
  };
  let meetingRepo: { createQueryBuilder: jest.Mock };
  let minutesRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let participantRepo: { find: jest.Mock };
  let em: { getRepository: jest.Mock };
  let authzRepo: { getEffectiveRolesAndPermissions: jest.Mock };

  const authUser = { userId: 'host-1' };
  const meetingId = 'meeting-1';

  const baseMeeting: Partial<MeetingEntity> = {
    id: meetingId,
    title: 'Họp review Sprint 12',
    hostId: 'host-1',
    status: MeetingStatus.IN_PROGRESS,
    actualStartTime: new Date('2026-07-02T09:00:00Z'),
    actualEndTime: null,
    roomId: 'room-1',
    deletedAt: null,
  };

  const buildParticipant = (
    overrides: Partial<MeetingParticipantEntity>,
  ): MeetingParticipantEntity =>
    ({
      userId: 'user-x',
      participantRole: ParticipantRole.ATTENDEE,
      attendanceStatus: ParticipantAttendanceStatus.NOT_CHECKED_IN,
      joinedAt: null,
      leftAt: null,
      ...overrides,
    }) as MeetingParticipantEntity;

  beforeEach(() => {
    meetingQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ ...baseMeeting }),
    };
    meetingRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(meetingQueryBuilder),
    };
    minutesRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) =>
        Promise.resolve({
          id: 'minutes-1',
          createdAt: new Date('2026-07-02T09:15:00Z'),
          versionNo: 1,
          ...data,
        }),
      ),
    };
    participantRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    em = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === MeetingEntity) return meetingRepo;
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === MeetingParticipantEntity) return participantRepo;
        throw new Error(
          'Unexpected entity requested in test: ' + String(entity),
        );
      }),
    };

    dataSource = {
      transaction: jest.fn((cb: (manager: unknown) => unknown) => cb(em)),
    };

    auditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    };

    authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: [], permissions: [] }),
    };

    service = new MinutesService(
      dataSource as unknown as DataSource,
      auditLogsService as unknown as AuditLogsService,
      authzRepo as unknown as AuthzReadRepository,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createDraft - happy path', () => {
    it('creates a draft when meeting is in_progress', async () => {
      participantRepo.find.mockResolvedValue([
        buildParticipant({
          userId: 'host-1',
          participantRole: ParticipantRole.HOST,
          attendanceStatus: ParticipantAttendanceStatus.PRESENT,
          joinedAt: new Date(),
        }),
        buildParticipant({ userId: 'user-2' }),
      ]);

      const result = await service.createDraft(meetingId, {}, authUser);

      expect(result.status).toBe(MeetingMinutesStatus.DRAFT);
      expect(result.visibilityLevel).toBe(
        MeetingMinutesVisibilityLevel.PRIVATE,
      );
      expect(result.preparedBy).toBe('host-1');
      expect(result.title).toBe('Biên bản họp: Họp review Sprint 12');
      expect(result.meetingSnapshot.attendees).toHaveLength(2);
      expect(result.meetingSnapshot.actualEndTime).toBeNull();
      expect(auditLogsService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'host-1',
          actionType: 'meeting_minutes_draft_created',
          entityType: 'meeting_minutes',
          entityId: 'minutes-1',
        }),
      );
    });

    it('uses custom title when provided', async () => {
      const dto: CreateDraftMinutesDto = { title: 'Biên bản tuỳ chỉnh' };
      const result = await service.createDraft(meetingId, dto, authUser);
      expect(result.title).toBe('Biên bản tuỳ chỉnh');
    });

    it('allows creation when meeting is completed and reflects actualEndTime', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        status: MeetingStatus.COMPLETED,
        actualEndTime: new Date('2026-07-02T10:00:00Z'),
      });

      const result = await service.createDraft(meetingId, {}, authUser);
      expect(result.meetingSnapshot.meetingStatus).toBe(
        MeetingStatus.COMPLETED,
      );
      expect(result.meetingSnapshot.actualEndTime).toEqual(
        new Date('2026-07-02T10:00:00Z'),
      );
    });
  });

  describe('createDraft - error paths', () => {
    it('throws MEETING_NOT_FOUND when meeting does not exist', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue(null);

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws MEETING_NOT_FOUND when meeting is soft-deleted', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        deletedAt: new Date(),
      });

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws MEETING_HOST_NOT_ASSIGNED when hostId is null', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        hostId: null,
      });

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({ code: 'MEETING_HOST_NOT_ASSIGNED' }),
        }),
      });
    });

    it('throws NOT_MEETING_HOST when caller is not the host', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        hostId: 'someone-else',
      });

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws MEETING_NOT_STARTED when meeting is scheduled', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        status: MeetingStatus.SCHEDULED,
      });

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({ code: 'MEETING_NOT_STARTED' }),
        }),
      });
    });

    it('throws MEETING_CANCELLED when meeting is cancelled', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        status: MeetingStatus.CANCELLED,
      });

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({ code: 'MEETING_CANCELLED' }),
        }),
      });
    });

    it('throws MINUTES_ALREADY_EXISTS when a draft already exists', async () => {
      minutesRepo.findOne.mockResolvedValue({ id: 'existing-minutes' });

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({
            code: 'MINUTES_ALREADY_EXISTS',
            details: expect.objectContaining({
              existingMinutesId: 'existing-minutes',
            }),
          }),
        }),
      });

      expect(minutesRepo.save).not.toHaveBeenCalled();
    });

    it('does not call audit log when creation fails', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue(null);
      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toThrow();
      expect(auditLogsService.logAction).not.toHaveBeenCalled();
    });
  });
});
