import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MeetingNotificationsService } from './meeting-notifications.service.js';
import { NotificationsService } from '../notifications.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import {
  NotificationEntity,
  NotificationType,
  NotificationChannel,
  NotificationDeliveryStatus,
} from '../entities/notification.entity.js';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../../meetings/entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../../meetings/entities/meeting-external-participant.entity.js';
import { MeetingAgendaEntity } from '../../meetings/entities/meeting-agenda.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
} from '../../minutes/entities/meeting-minutes.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { MediaFileEntity } from '../../recording/entities/media-file.entity.js';
import { TranscriptEntity } from '../../transcription/entities/transcript.entity.js';
import { StorageService } from '../../storage/storage.service.js';
import { SendMeetingInvitationDto } from '../dto/send-meeting-invitation.dto.js';
import { SendMeetingReminderDto } from '../dto/send-meeting-reminder.dto.js';
import { ResendCancellationNotificationDto } from '../dto/resend-cancellation-notification.dto.js';
import { DistributeMeetingMinutesDto } from '../dto/distribute-meeting-minutes.dto.js';

function makeMockMeeting(
  overrides: Partial<MeetingEntity> = {},
): MeetingEntity {
  const m = new MeetingEntity();
  m.id = 'meeting-uuid-1';
  m.title = 'Test Meeting';
  m.status = MeetingStatus.SCHEDULED;
  m.organizerId = 'organizer-uuid';
  m.hostId = 'host-uuid';
  m.startTime = new Date(Date.now() + 86400000);
  m.endTime = new Date(Date.now() + 90000000);
  Object.assign(m, overrides);
  return m;
}

function makeMockMinutes(
  overrides: Partial<MeetingMinutesEntity> = {},
): MeetingMinutesEntity {
  const m = new MeetingMinutesEntity();
  m.id = 'minutes-uuid-1';
  m.meetingId = 'meeting-uuid-1';
  m.title = 'Test Minutes';
  m.status = MeetingMinutesStatus.PUBLISHED;
  m.preparedBy = 'preparer-uuid';
  Object.assign(m, overrides);
  return m;
}

describe('MeetingNotificationsService', () => {
  let service: MeetingNotificationsService;
  let notificationsService: jest.Mocked<NotificationsService>;
  let authzReadRepo: jest.Mocked<AuthzReadRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let meetingRepo: jest.Mocked<any>;
  let participantRepo: jest.Mocked<any>;
  let externalParticipantRepo: jest.Mocked<any>;
  let agendaRepo: jest.Mocked<any>;
  let minutesRepo: jest.Mocked<any>;
  let userRepo: jest.Mocked<any>;
  let mediaFileRepo: jest.Mocked<any>;
  let transcriptRepo: jest.Mocked<any>;
  let storageService: jest.Mocked<any>;

  const authUser = { userId: 'organizer-uuid' };
  const adminUser = { userId: 'admin-uuid' };
  const strangerUser = { userId: 'stranger-uuid' };

  beforeEach(async () => {
    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({
        id: 'notif-uuid',
        deliveryStatus: NotificationDeliveryStatus.DRAFT,
      }),
      enqueueEmailNotification: jest.fn().mockResolvedValue({
        notification: { id: 'notif-uuid' },
        jobId: 'job-1',
      }),
    } as any;

    authzReadRepo = {
      getEffectiveRolesAndPermissions: jest.fn(),
    } as any;

    auditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    } as any;

    meetingRepo = {
      findOne: jest.fn(),
    };

    participantRepo = {
      find: jest.fn(),
    };

    externalParticipantRepo = {
      find: jest.fn(),
    };

    agendaRepo = {
      find: jest.fn(),
    };

    minutesRepo = {
      findOne: jest.fn(),
      update: jest.fn(),
    };

    userRepo = {
      findOne: jest.fn(),
    };

    mediaFileRepo = {
      findOne: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'media-file-uuid-1', ...v })),
    };

    transcriptRepo = {
      findOne: jest.fn(),
    };

    storageService = {
      saveFile: jest.fn().mockResolvedValue({
        storageKey: 'exports/minutes-uuid-1.pdf',
        publicUrl: 'http://localhost/exports/minutes-uuid-1.pdf',
        sizeBytes: 1234,
      }),
      getDriver: jest.fn().mockReturnValue('local'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingNotificationsService,
        { provide: getRepositoryToken(MeetingEntity), useValue: meetingRepo },
        {
          provide: getRepositoryToken(MeetingParticipantEntity),
          useValue: participantRepo,
        },
        {
          provide: getRepositoryToken(MeetingExternalParticipantEntity),
          useValue: externalParticipantRepo,
        },
        {
          provide: getRepositoryToken(MeetingAgendaEntity),
          useValue: agendaRepo,
        },
        {
          provide: getRepositoryToken(MeetingMinutesEntity),
          useValue: minutesRepo,
        },
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        {
          provide: getRepositoryToken(MediaFileEntity),
          useValue: mediaFileRepo,
        },
        {
          provide: getRepositoryToken(TranscriptEntity),
          useValue: transcriptRepo,
        },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuthzReadRepository, useValue: authzReadRepo },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();

    service = module.get<MeetingNotificationsService>(
      MeetingNotificationsService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── sendMeetingInvitation ──

  describe('sendMeetingInvitation', () => {
    it('[T001] should send invitation successfully for organizer', async () => {
      const meeting = makeMockMeeting();
      meetingRepo.findOne.mockResolvedValue(meeting);
      participantRepo.find.mockResolvedValue([]);
      externalParticipantRepo.find.mockResolvedValue([]);

      const user = await service.sendMeetingInvitation(
        'meeting-uuid-1',
        authUser,
        {
          channels: ['email', 'in_app'],
          includeAgenda: false,
        },
      );

      expect(user.queuedRecipientCount).toBeGreaterThanOrEqual(0);
      expect(notificationsService.createNotification).toHaveBeenCalled();
      expect(auditLogsService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'meeting_invitation_sent' }),
      );
    });

    it('[T002] should reject when meeting not found', async () => {
      meetingRepo.findOne.mockResolvedValue(null);
      await expect(
        service.sendMeetingInvitation('nonexistent', authUser, {
          channels: ['email'],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('[T003] should reject when meeting is cancelled', async () => {
      meetingRepo.findOne.mockResolvedValue(
        makeMockMeeting({ status: MeetingStatus.CANCELLED }),
      );
      await expect(
        service.sendMeetingInvitation('meeting-uuid-1', authUser, {
          channels: ['email'],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('[T004] should reject when user is not owner and not admin', async () => {
      meetingRepo.findOne.mockResolvedValue(makeMockMeeting());
      authzReadRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });
      await expect(
        service.sendMeetingInvitation('meeting-uuid-1', strangerUser, {
          channels: ['email'],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('[T005] should allow admin even if not owner', async () => {
      const meeting = makeMockMeeting();
      meetingRepo.findOne.mockResolvedValue(meeting);
      participantRepo.find.mockResolvedValue([]);
      externalParticipantRepo.find.mockResolvedValue([]);
      authzReadRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: [],
      });

      const result = await service.sendMeetingInvitation(
        'meeting-uuid-1',
        adminUser,
        { channels: ['in_app'] },
      );
      expect(result.queuedRecipientCount).toBeGreaterThanOrEqual(0);
    });

    it('[T006] should include agenda content when includeAgenda=true', async () => {
      const meeting = makeMockMeeting();
      meetingRepo.findOne.mockResolvedValue(meeting);
      participantRepo.find.mockResolvedValue([
        { userId: 'participant-1' } as MeetingParticipantEntity,
      ]);
      externalParticipantRepo.find.mockResolvedValue([]);
      agendaRepo.find.mockResolvedValue([
        { title: 'Agenda 1', agendaOrder: 1 } as MeetingAgendaEntity,
      ]);

      await service.sendMeetingInvitation('meeting-uuid-1', authUser, {
        channels: ['in_app'],
        includeAgenda: true,
      });
      expect(agendaRepo.find).toHaveBeenCalled();
    });

    it('[T007] should create exactly ONE in_app notification row (no duplicate/phantom row)', async () => {
      const meeting = makeMockMeeting();
      meetingRepo.findOne.mockResolvedValue(meeting);
      participantRepo.find.mockResolvedValue([
        { userId: 'participant-1' } as MeetingParticipantEntity,
      ]);
      externalParticipantRepo.find.mockResolvedValue([]);

      await service.sendMeetingInvitation('meeting-uuid-1', authUser, {
        channels: ['in_app'],
      });
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    });

    it('[T008] should NOT create an in_app notification when channels=["email"] only', async () => {
      const meeting = makeMockMeeting();
      meetingRepo.findOne.mockResolvedValue(meeting);
      participantRepo.find.mockResolvedValue([
        { userId: 'participant-1' } as MeetingParticipantEntity,
      ]);
      externalParticipantRepo.find.mockResolvedValue([]);
      userRepo.findOne.mockResolvedValue({
        id: 'participant-1',
        email: 'p1@test.com',
      });

      await service.sendMeetingInvitation('meeting-uuid-1', authUser, {
        channels: ['email'],
      });
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
      expect(
        notificationsService.enqueueEmailNotification,
      ).toHaveBeenCalledTimes(1);
    });

    it('[T009] should check ownership BEFORE revealing cancelled status (stranger gets 403, not 409)', async () => {
      meetingRepo.findOne.mockResolvedValue(
        makeMockMeeting({ status: MeetingStatus.CANCELLED }),
      );
      authzReadRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });

      await expect(
        service.sendMeetingInvitation('meeting-uuid-1', strangerUser, {
          channels: ['email'],
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── sendMeetingReminder ──

  describe('sendMeetingReminder', () => {
    it('[T101] should send manual reminder successfully', async () => {
      const meeting = makeMockMeeting();
      meetingRepo.findOne.mockResolvedValue(meeting);
      participantRepo.find.mockResolvedValue([]);
      externalParticipantRepo.find.mockResolvedValue([]);

      const result = await service.sendMeetingReminder(
        'meeting-uuid-1',
        authUser,
        {
          channels: ['in_app'],
          reminderType: 'manual',
        },
      );

      expect(result.deliveryStatus).toBeDefined();
      expect(result.scheduledSendAt).toBeNull();
    });

    it('[T102] should create scheduled reminder with future sendAt', async () => {
      const meeting = makeMockMeeting();
      meetingRepo.findOne.mockResolvedValue(meeting);
      participantRepo.find.mockResolvedValue([]);
      externalParticipantRepo.find.mockResolvedValue([]);

      const sendAt = new Date(Date.now() + 3600000).toISOString();
      const result = await service.sendMeetingReminder(
        'meeting-uuid-1',
        authUser,
        {
          channels: ['in_app'],
          reminderType: 'scheduled',
          sendAt,
        },
      );

      expect(result.deliveryStatus).toBe('draft');
      expect(result.scheduledSendAt).toBe(sendAt);
    });

    it('[T103] should reject scheduled reminder without sendAt', async () => {
      meetingRepo.findOne.mockResolvedValue(makeMockMeeting());
      await expect(
        service.sendMeetingReminder('meeting-uuid-1', authUser, {
          channels: ['in_app'],
          reminderType: 'scheduled',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('[T104] should reject when meeting is not upcoming', async () => {
      meetingRepo.findOne.mockResolvedValue(
        makeMockMeeting({
          status: MeetingStatus.IN_PROGRESS,
        }),
      );
      await expect(
        service.sendMeetingReminder('meeting-uuid-1', authUser, {
          channels: ['in_app'],
          reminderType: 'manual',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('[T105] should reject sendAt after meeting startTime', async () => {
      const meeting = makeMockMeeting({
        startTime: new Date(Date.now() + 7200000),
      });
      meetingRepo.findOne.mockResolvedValue(meeting);
      const sendAt = new Date(Date.now() + 14400000).toISOString();
      await expect(
        service.sendMeetingReminder('meeting-uuid-1', authUser, {
          channels: ['in_app'],
          reminderType: 'scheduled',
          sendAt,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('[T106] scheduled reminder should respect requested channels (email creates an EMAIL-channel row, not IN_APP)', async () => {
      const meeting = makeMockMeeting();
      meetingRepo.findOne.mockResolvedValue(meeting);
      participantRepo.find.mockResolvedValue([]);
      externalParticipantRepo.find.mockResolvedValue([]);

      const sendAt = new Date(Date.now() + 3600000).toISOString();
      await service.sendMeetingReminder('meeting-uuid-1', authUser, {
        channels: ['email'],
        reminderType: 'scheduled',
        sendAt,
      });

      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ channel: NotificationChannel.EMAIL }),
      );
    });

    it('[T107] manual reminder should create exactly ONE notification row per requested channel (no duplicate)', async () => {
      const meeting = makeMockMeeting();
      meetingRepo.findOne.mockResolvedValue(meeting);
      participantRepo.find.mockResolvedValue([]);
      externalParticipantRepo.find.mockResolvedValue([]);

      await service.sendMeetingReminder('meeting-uuid-1', authUser, {
        channels: ['in_app'],
        reminderType: 'manual',
      });

      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    });
  });

  // ── resendCancellationNotification ──

  describe('resendCancellationNotification', () => {
    it('[T201] should resend cancellation for cancelled meeting', async () => {
      const meeting = makeMockMeeting({
        status: MeetingStatus.CANCELLED,
        cancellationReason: 'Room unavailable',
      });
      meetingRepo.findOne.mockResolvedValue(meeting);
      participantRepo.find.mockResolvedValue([]);
      externalParticipantRepo.find.mockResolvedValue([]);

      const result = await service.resendCancellationNotification(
        'meeting-uuid-1',
        authUser,
        {
          channels: ['in_app'],
        },
      );

      expect(result.meetingId).toBe('meeting-uuid-1');
      expect(result.queuedRecipientCount).toBeGreaterThanOrEqual(0);
    });

    it('[T202] should use custom reason if provided', async () => {
      const meeting = makeMockMeeting({
        status: MeetingStatus.CANCELLED,
        cancellationReason: 'Original reason',
      });
      meetingRepo.findOne.mockResolvedValue(meeting);
      participantRepo.find.mockResolvedValue([]);
      externalParticipantRepo.find.mockResolvedValue([]);

      await service.resendCancellationNotification('meeting-uuid-1', authUser, {
        channels: ['in_app'],
        reason: 'Custom reason',
      });
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.CANCELLATION,
        }),
      );
    });

    it('[T203] should reject when meeting is not cancelled', async () => {
      meetingRepo.findOne.mockResolvedValue(
        makeMockMeeting({ status: MeetingStatus.SCHEDULED }),
      );
      await expect(
        service.resendCancellationNotification('meeting-uuid-1', authUser, {
          channels: ['in_app'],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('[T204] should create exactly ONE notification row (no duplicate/phantom row)', async () => {
      const meeting = makeMockMeeting({ status: MeetingStatus.CANCELLED });
      meetingRepo.findOne.mockResolvedValue(meeting);
      participantRepo.find.mockResolvedValue([]);
      externalParticipantRepo.find.mockResolvedValue([]);

      await service.resendCancellationNotification('meeting-uuid-1', authUser, {
        channels: ['in_app'],
      });
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    });
  });

  // ── distributeMeetingMinutes ──

  describe('distributeMeetingMinutes', () => {
    it('[T301] should distribute minutes to participants', async () => {
      const meeting = makeMockMeeting();
      const minutes = makeMockMinutes();
      meetingRepo.findOne.mockResolvedValue(meeting);
      minutesRepo.findOne.mockResolvedValue(minutes);
      participantRepo.find.mockResolvedValue([]);
      externalParticipantRepo.find.mockResolvedValue([]);

      const result = await service.distributeMeetingMinutes(
        'meeting-uuid-1',
        authUser,
        {
          minutesId: 'minutes-uuid-1',
          recipientScope: 'participants',
          channels: ['in_app'],
        },
      );

      expect(result.minutesId).toBe('minutes-uuid-1');
      expect(result.queuedRecipientCount).toBeGreaterThanOrEqual(0);
    });

    it('[T302] should distribute to custom recipients', async () => {
      const meeting = makeMockMeeting();
      const minutes = makeMockMinutes();
      meetingRepo.findOne.mockResolvedValue(meeting);
      minutesRepo.findOne.mockResolvedValue(minutes);
      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
      });
      participantRepo.find.mockResolvedValue([]);
      externalParticipantRepo.find.mockResolvedValue([]);

      const result = await service.distributeMeetingMinutes(
        'meeting-uuid-1',
        authUser,
        {
          minutesId: 'minutes-uuid-1',
          recipientScope: 'custom',
          recipientUserIds: ['user-1'],
          channels: ['in_app'],
        },
      );

      expect(result.queuedRecipientCount).toBe(1);
    });

    it('[T303] should reject when minutes not published', async () => {
      meetingRepo.findOne.mockResolvedValue(makeMockMeeting());
      minutesRepo.findOne.mockResolvedValue(
        makeMockMinutes({ status: MeetingMinutesStatus.DRAFT }),
      );
      await expect(
        service.distributeMeetingMinutes('meeting-uuid-1', authUser, {
          minutesId: 'minutes-uuid-1',
          recipientScope: 'participants',
          channels: ['in_app'],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('[T304] should reject when minutes not found', async () => {
      meetingRepo.findOne.mockResolvedValue(makeMockMeeting());
      minutesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.distributeMeetingMinutes('meeting-uuid-1', authUser, {
          minutesId: 'nonexistent',
          recipientScope: 'participants',
          channels: ['in_app'],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('[T305] should reject custom scope without recipientUserIds', async () => {
      meetingRepo.findOne.mockResolvedValue(makeMockMeeting());
      minutesRepo.findOne.mockResolvedValue(makeMockMinutes());
      await expect(
        service.distributeMeetingMinutes('meeting-uuid-1', authUser, {
          minutesId: 'minutes-uuid-1',
          recipientScope: 'custom',
          channels: ['in_app'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('[T306] should create exactly ONE notification row (no duplicate/phantom row)', async () => {
      const meeting = makeMockMeeting();
      const minutes = makeMockMinutes();
      meetingRepo.findOne.mockResolvedValue(meeting);
      minutesRepo.findOne.mockResolvedValue(minutes);
      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
      });
      participantRepo.find.mockResolvedValue([
        { userId: 'user-1' } as MeetingParticipantEntity,
      ]);
      externalParticipantRepo.find.mockResolvedValue([]);

      await service.distributeMeetingMinutes('meeting-uuid-1', authUser, {
        minutesId: 'minutes-uuid-1',
        recipientScope: 'participants',
        channels: ['in_app'],
      });
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    });

    it('[T307] should attach a freshly-rendered PDF when emailing external guests without an existing export', async () => {
      const meeting = makeMockMeeting();
      const minutes = makeMockMinutes({ fileId: null });
      meetingRepo.findOne.mockResolvedValue(meeting);
      minutesRepo.findOne.mockResolvedValue(minutes);
      participantRepo.find.mockResolvedValue([]);
      externalParticipantRepo.find.mockResolvedValue([
        { email: 'guest@external.com' },
      ]);

      await service.distributeMeetingMinutes('meeting-uuid-1', authUser, {
        minutesId: 'minutes-uuid-1',
        recipientScope: 'participants',
        channels: ['email'],
      });

      // Không có export sẵn (fileId null) → phải tự render + lưu media file mới.
      expect(storageService.saveFile).toHaveBeenCalledTimes(1);
      expect(mediaFileRepo.save).toHaveBeenCalledTimes(1);
      expect(minutesRepo.update).toHaveBeenCalledWith('minutes-uuid-1', {
        fileId: 'media-file-uuid-1',
      });

      const guestCall =
        notificationsService.enqueueEmailNotification.mock.calls.find((call) =>
          call[0].toEmails.includes('guest@external.com'),
        );
      expect(guestCall).toBeDefined();
      expect(guestCall![0].attachment).toEqual({
        storageKey: 'exports/minutes-uuid-1.pdf',
        fileName: expect.any(String),
        mimeType: 'application/pdf',
      });
    });

    it('[T308] should reuse the existing exported PDF (fileId already set) instead of re-rendering', async () => {
      const meeting = makeMockMeeting();
      const minutes = makeMockMinutes({ fileId: 'existing-media-uuid' });
      meetingRepo.findOne.mockResolvedValue(meeting);
      minutesRepo.findOne.mockResolvedValue(minutes);
      participantRepo.find.mockResolvedValue([]);
      externalParticipantRepo.find.mockResolvedValue([
        { email: 'guest@external.com' },
      ]);
      mediaFileRepo.findOne.mockResolvedValue({
        id: 'existing-media-uuid',
        storageKey: 'exports/already-exported.pdf',
        fileName: 'Tom_tat_cuoc_hop_Test_Meeting.pdf',
        mimeType: 'application/pdf',
      });

      await service.distributeMeetingMinutes('meeting-uuid-1', authUser, {
        minutesId: 'minutes-uuid-1',
        recipientScope: 'participants',
        channels: ['email'],
      });

      expect(storageService.saveFile).not.toHaveBeenCalled();
      expect(mediaFileRepo.save).not.toHaveBeenCalled();
      const guestCall =
        notificationsService.enqueueEmailNotification.mock.calls.find((call) =>
          call[0].toEmails.includes('guest@external.com'),
        );
      expect(guestCall![0].attachment).toEqual({
        storageKey: 'exports/already-exported.pdf',
        fileName: 'Tom_tat_cuoc_hop_Test_Meeting.pdf',
        mimeType: 'application/pdf',
      });
    });
  });

  // ── DTO validation: channels must not be empty ──

  describe('channels validation (empty array must be rejected)', () => {
    it('SendMeetingInvitationDto should reject channels=[]', async () => {
      const dto = plainToInstance(SendMeetingInvitationDto, { channels: [] });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'channels')).toBe(true);
    });

    it('SendMeetingReminderDto should reject channels=[]', async () => {
      const dto = plainToInstance(SendMeetingReminderDto, {
        channels: [],
        reminderType: 'manual',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'channels')).toBe(true);
    });

    it('ResendCancellationNotificationDto should reject channels=[]', async () => {
      const dto = plainToInstance(ResendCancellationNotificationDto, {
        channels: [],
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'channels')).toBe(true);
    });

    it('DistributeMeetingMinutesDto should reject channels=[]', async () => {
      const dto = plainToInstance(DistributeMeetingMinutesDto, {
        minutesId: '11111111-1111-1111-1111-111111111111',
        recipientScope: 'participants',
        channels: [],
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'channels')).toBe(true);
    });
  });
});
