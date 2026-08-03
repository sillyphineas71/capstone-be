/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { MeetingRequestReviewService } from '../services/meeting-request-review.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { MeetingEntity, MeetingStatus } from '../entities/meeting.entity.js';
import {
  MeetingRequestEntity,
  MeetingRequestType,
  ApprovalStatus,
  ConflictCheckStatus,
} from '../entities/meeting-request.entity.js';
import { MeetingParticipantEntity } from '../entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../entities/meeting-external-participant.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../entities/meeting-event.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
} from '../../rooms/entities/room-booking.entity.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import { ApproveMeetingRequestDto } from '../dto/approve-meeting-request.dto.js';
import { RejectMeetingRequestDto } from '../dto/reject-meeting-request.dto.js';

describe('MeetingRequestReviewService', () => {
  let service: MeetingRequestReviewService;
  let dataSource: jest.Mocked<DataSource>;
  let notificationsService: jest.Mocked<NotificationsService>;
  let em: jest.Mocked<EntityManager>;

  const authUser = { userId: 'approver-uuid' };
  const creatorUser = { userId: 'creator-uuid' };
  const clientContext = { ipAddress: '127.0.0.1', userAgent: 'test' };

  const mockRequest = (
    overrides: Partial<MeetingRequestEntity> = {},
  ): MeetingRequestEntity =>
    ({
      id: 'request-uuid',
      requestCode: 'MT-20260715-001',
      meetingId: 'meeting-uuid',
      requestType: MeetingRequestType.CREATE_MEETING,
      requestedBy: creatorUser.userId,
      requestedAt: new Date('2026-07-15T09:00:00Z'),
      targetRoomId: 'room-uuid',
      requestedStartTime: new Date('2026-07-15T10:00:00Z'),
      requestedEndTime: new Date('2026-07-15T11:00:00Z'),
      approvalMode: 'manual' as any,
      approvalStatus: ApprovalStatus.PENDING,
      conflictCheckStatus: ConflictCheckStatus.CLEAR,
      conflictCheckedAt: null,
      conflictSummaryJson: null,
      decisionBy: null,
      decisionAt: null,
      rejectionReason: null,
      requestPayloadJson: {},
      ruleSnapshotJson: null,
      appliedAt: null,
      notes: null,
      ...overrides,
    }) as MeetingRequestEntity;

  const mockMeeting = (overrides: Partial<MeetingEntity> = {}): MeetingEntity =>
    ({
      id: 'meeting-uuid',
      meetingCode: 'MT-20260715-001',
      title: 'Test Meeting',
      organizerId: creatorUser.userId,
      hostId: creatorUser.userId,
      roomId: 'room-uuid',
      startTime: new Date('2026-07-15T10:00:00Z'),
      endTime: new Date('2026-07-15T11:00:00Z'),
      status: MeetingStatus.PENDING_APPROVAL,
      cancellationReason: null,
      updatedBy: null,
      updatedAt: new Date('2026-07-15T09:00:00Z'),
      ...overrides,
    }) as MeetingEntity;

  const mockBooking = (
    overrides: Partial<RoomBookingEntity> = {},
  ): RoomBookingEntity =>
    ({
      id: 'booking-uuid',
      bookingCode: 'BK-20260715-001',
      meetingId: 'meeting-uuid',
      roomId: 'room-uuid',
      bookingType: 'scheduled' as any,
      reservedStartTime: new Date('2026-07-15T10:00:00Z'),
      reservedEndTime: new Date('2026-07-15T11:00:00Z'),
      status: RoomBookingStatus.PENDING,
      approvedBy: null,
      approvedAt: null,
      cancellationReason: null,
      bookedBy: creatorUser.userId,
      ...overrides,
    }) as RoomBookingEntity;

  beforeEach(async () => {
    em = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(<T>(_: any, plain: T): T => plain),
      save: jest.fn(async (_entity: any, data: any) => {
        if (data && typeof data === 'object') {
          if (!data.id) data.id = 'saved-uuid';
          return data;
        }
        return _entity;
      }),
      getRepository: jest
        .fn()
        .mockReturnValue({ find: jest.fn().mockResolvedValue([]) }),
    } as unknown as jest.Mocked<EntityManager>;

    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (manager: EntityManager) => unknown) =>
          cb(em),
        ),
      manager: em,
      getRepository: jest
        .fn()
        .mockReturnValue({ find: jest.fn().mockResolvedValue([]) }),
    } as unknown as jest.Mocked<DataSource>;

    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-id' }),
      enqueueEmailNotification: jest.fn().mockResolvedValue({
        notification: { id: 'notif-id' },
        jobId: 'bull-job-id',
      }),
    } as unknown as jest.Mocked<NotificationsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingRequestReviewService,
        { provide: DataSource, useValue: dataSource },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<MeetingRequestReviewService>(
      MeetingRequestReviewService,
    );
  });

  describe('approve', () => {
    const approveDto: ApproveMeetingRequestDto = {};

    function setupSuccessMocks() {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(mockBooking());

      const conflictFind = jest.fn().mockResolvedValue([]);
      em.find = conflictFind as any;
    }

    it('[AC-001] should approve successfully with all state transitions', async () => {
      setupSuccessMocks();

      const result = await service.approve(
        'request-uuid',
        approveDto,
        authUser,
        clientContext,
      );

      expect(result.requestId).toBe('request-uuid');
      expect(result.approvalStatus).toBe(ApprovalStatus.APPROVED);
      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.bookingId).toBe('booking-uuid');
      expect(result.appliedAt).toBeDefined();

      expect(em.save).toHaveBeenCalledWith(
        MeetingRequestEntity,
        expect.objectContaining({
          approvalStatus: ApprovalStatus.APPROVED,
          decisionBy: authUser.userId,
        }),
      );
      expect(em.save).toHaveBeenCalledWith(
        MeetingEntity,
        expect.objectContaining({
          status: MeetingStatus.SCHEDULED,
        }),
      );
      expect(em.save).toHaveBeenCalledWith(
        RoomBookingEntity,
        expect.objectContaining({
          status: RoomBookingStatus.APPROVED,
        }),
      );
    });

    it('[AC-001] should create meeting event with type meeting_request_approved', async () => {
      setupSuccessMocks();

      await service.approve(
        'request-uuid',
        approveDto,
        authUser,
        clientContext,
      );

      expect(em.create).toHaveBeenCalledWith(
        MeetingEventEntity,
        expect.objectContaining({
          eventType: MeetingEventType.MEETING_REQUEST_APPROVED,
        }),
      );
      expect(em.save).toHaveBeenCalledWith(
        MeetingEventEntity,
        expect.any(Object),
      );
    });

    it('[AC-011] should call NotificationsService for MEETING_INVITE and MEETING_REQUEST_APPROVED', async () => {
      setupSuccessMocks();
      em.find = jest
        .fn()
        .mockResolvedValueOnce([
          { userId: 'participant-1' } as MeetingParticipantEntity,
          { userId: 'participant-2' } as MeetingParticipantEntity,
        ])
        .mockResolvedValueOnce([
          { email: 'external@test.com' } as MeetingExternalParticipantEntity,
        ]);

      await service.approve(
        'request-uuid',
        approveDto,
        authUser,
        clientContext,
      );

      // createNotification called for internal participants + requester/host
      expect(notificationsService.createNotification).toHaveBeenCalled();
      const createCalls = (
        notificationsService.createNotification as jest.Mock
      ).mock.calls.map(([arg]) => arg.notificationType);

      // Participans get MEETING_INVITE, requester gets MEETING_REQUEST_APPROVED
      expect(
        createCalls.filter((t: string) => t === NotificationType.MEETING_INVITE)
          .length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        createCalls.filter(
          (t: string) => t === NotificationType.MEETING_REQUEST_APPROVED,
        ).length,
      ).toBeGreaterThanOrEqual(1);

      // enqueueEmailNotification called for external participants
      expect(
        notificationsService.enqueueEmailNotification,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.MEETING_INVITE,
          toEmails: ['external@test.com'],
        }),
      );
    });

    it('[AC-011b] should NOT email internal participants on approve (in-app only, to reduce email load)', async () => {
      setupSuccessMocks();
      em.find = jest
        .fn()
        .mockResolvedValueOnce([
          { userId: 'participant-1' } as MeetingParticipantEntity,
          { userId: 'participant-2' } as MeetingParticipantEntity,
        ])
        .mockResolvedValueOnce([]);

      await service.approve(
        'request-uuid',
        approveDto,
        authUser,
        clientContext,
      );

      expect(
        notificationsService.enqueueEmailNotification,
      ).not.toHaveBeenCalled();
    });

    it('[AC-013] should create audit log with action_type approve', async () => {
      setupSuccessMocks();

      await service.approve(
        'request-uuid',
        approveDto,
        authUser,
        clientContext,
      );

      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({
          actionType: 'approve',
          entityType: 'meeting_request',
          entityId: 'request-uuid',
          userId: authUser.userId,
        }),
      );
    });

    it('[AC-003] should throw 404 when request not found', async () => {
      em.findOne.mockResolvedValueOnce(null);

      await expect(
        service.approve(
          'nonexistent-uuid',
          approveDto,
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('[AC-005] should throw 409 when request already approved', async () => {
      em.findOne.mockResolvedValueOnce(
        mockRequest({ approvalStatus: ApprovalStatus.APPROVED }),
      );

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('[AC-009b] should throw 403 when self-approval (requested_by matches)', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest({ requestedBy: authUser.userId }))
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(mockBooking());

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ForbiddenException);
    });

    it('[AC-009b] should throw 403 when self-approval (organizer matches)', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting({ organizerId: authUser.userId }))
        .mockResolvedValueOnce(mockBooking());

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw 422 when request_type is not create_meeting', async () => {
      em.findOne.mockResolvedValueOnce(
        mockRequest({ requestType: MeetingRequestType.CANCEL_MEETING }),
      );

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should handle notification failures gracefully (approve still succeeds)', async () => {
      setupSuccessMocks();
      em.find = jest
        .fn()
        .mockResolvedValueOnce([
          { userId: 'participant-1' } as MeetingParticipantEntity,
        ])
        .mockResolvedValueOnce([]);

      notificationsService.createNotification.mockRejectedValue(
        new Error('Notify service down'),
      );

      const result = await service.approve(
        'request-uuid',
        approveDto,
        authUser,
        clientContext,
      );

      // Approve still succeeds despite notification failure
      expect(result.requestId).toBe('request-uuid');
      expect(result.approvalStatus).toBe(ApprovalStatus.APPROVED);
    });

    it('should throw 409 when meeting status is not pending_approval', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting({ status: MeetingStatus.SCHEDULED }))
        .mockResolvedValueOnce(mockBooking());

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw 409 when booking status is not pending', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(
          mockBooking({ status: RoomBookingStatus.APPROVED }),
        );

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw 404 when meeting not found', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(null);

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw 404 when booking not found', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(null);

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('[AC-007] should throw 409 when room conflict detected', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(mockBooking());

      em.getRepository = jest.fn().mockReturnValue({
        find: jest
          .fn()
          .mockResolvedValue([
            { id: 'conflicting-booking' } as RoomBookingEntity,
          ]),
      });

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('[AC-015] should rollback transaction on DB failure', async () => {
      setupSuccessMocks();

      dataSource.transaction.mockImplementation(async (_cb: any) => {
        throw new Error('DB Error');
      });

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow('DB Error');
    });
  });

  describe('reject', () => {
    const rejectDto: RejectMeetingRequestDto = {
      rejectionReason: 'Kế hoạch thay đổi',
    };

    function setupSuccessMocks() {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(mockBooking());
    }

    it('[AC-002] should reject successfully with all state transitions', async () => {
      setupSuccessMocks();

      const result = await service.reject(
        'request-uuid',
        rejectDto,
        authUser,
        clientContext,
      );

      expect(result.requestId).toBe('request-uuid');
      expect(result.approvalStatus).toBe(ApprovalStatus.REJECTED);
      expect(result.decisionAt).toBeDefined();

      expect(em.save).toHaveBeenCalledWith(
        MeetingRequestEntity,
        expect.objectContaining({
          approvalStatus: ApprovalStatus.REJECTED,
          rejectionReason: 'Kế hoạch thay đổi',
        }),
      );
      expect(em.save).toHaveBeenCalledWith(
        MeetingEntity,
        expect.objectContaining({
          status: MeetingStatus.CANCELLED,
          cancellationReason: 'Kế hoạch thay đổi',
        }),
      );
      expect(em.save).toHaveBeenCalledWith(
        RoomBookingEntity,
        expect.objectContaining({
          status: RoomBookingStatus.CANCELLED,
          cancellationReason: 'Kế hoạch thay đổi',
        }),
      );
    });

    it('[AC-002] should create meeting event with type meeting_request_rejected', async () => {
      setupSuccessMocks();

      await service.reject('request-uuid', rejectDto, authUser, clientContext);

      expect(em.create).toHaveBeenCalledWith(
        MeetingEventEntity,
        expect.objectContaining({
          eventType: MeetingEventType.MEETING_REQUEST_REJECTED,
        }),
      );
    });

    it('[AC-012] should NOT call enqueueEmailNotification for reject (in-app only)', async () => {
      setupSuccessMocks();

      await service.reject('request-uuid', rejectDto, authUser, clientContext);

      // Rejection uses createNotification (IN_APP), not enqueueEmailNotification
      expect(
        notificationsService.enqueueEmailNotification,
      ).not.toHaveBeenCalled();
    });

    it('[AC-012] should call createNotification with MEETING_REQUEST_REJECTED for creator', async () => {
      setupSuccessMocks();

      await service.reject('request-uuid', rejectDto, authUser, clientContext);

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.MEETING_REQUEST_REJECTED,
          channel: NotificationChannel.IN_APP,
          recipientUserIds: expect.arrayContaining([creatorUser.userId]),
        }),
      );
    });

    it('[AC-012] should notify only the host, not the requester, when they differ', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest({ requestedBy: 'requester-uuid' }))
        .mockResolvedValueOnce(mockMeeting({ hostId: 'host-uuid' }))
        .mockResolvedValueOnce(mockBooking());

      await service.reject('request-uuid', rejectDto, authUser, clientContext);

      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.MEETING_REQUEST_REJECTED,
          channel: NotificationChannel.IN_APP,
          recipientUserIds: ['host-uuid'],
        }),
      );
    });

    it('[AC-014] should create audit log with action_type reject', async () => {
      setupSuccessMocks();

      await service.reject('request-uuid', rejectDto, authUser, clientContext);

      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({
          actionType: 'reject',
          entityType: 'meeting_request',
          entityId: 'request-uuid',
        }),
      );
    });

    it('[AC-004] should throw 404 when request not found', async () => {
      em.findOne.mockResolvedValueOnce(null);

      await expect(
        service.reject('nonexistent-uuid', rejectDto, authUser, clientContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('[AC-006] should throw 409 when request already approved', async () => {
      em.findOne.mockResolvedValueOnce(
        mockRequest({ approvalStatus: ApprovalStatus.APPROVED }),
      );

      await expect(
        service.reject('request-uuid', rejectDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('[AC-009b] should throw 403 when self-approval', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest({ requestedBy: authUser.userId }))
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(mockBooking());

      await expect(
        service.reject('request-uuid', rejectDto, authUser, clientContext),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw 422 when request_type is not create_meeting', async () => {
      em.findOne.mockResolvedValueOnce(
        mockRequest({ requestType: MeetingRequestType.CANCEL_MEETING }),
      );

      await expect(
        service.reject('request-uuid', rejectDto, authUser, clientContext),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw 404 when meeting not found', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(null);

      await expect(
        service.reject('request-uuid', rejectDto, authUser, clientContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw 404 when booking not found', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(null);

      await expect(
        service.reject('request-uuid', rejectDto, authUser, clientContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle notification failure gracefully (reject still succeeds)', async () => {
      setupSuccessMocks();

      notificationsService.createNotification.mockRejectedValue(
        new Error('Notify service down'),
      );

      const result = await service.reject(
        'request-uuid',
        rejectDto,
        authUser,
        clientContext,
      );

      expect(result.requestId).toBe('request-uuid');
      expect(result.approvalStatus).toBe(ApprovalStatus.REJECTED);
    });

    it('should NOT save NotificationEntity inside transaction', async () => {
      setupSuccessMocks();

      await service.reject('request-uuid', rejectDto, authUser, clientContext);

      // No NotificationEntity save inside transaction
      const saveCalls = (em.save as jest.Mock).mock.calls;
      const notifSaves = saveCalls.filter(
        ([entity]) => entity === 'NotificationEntity',
      );
      expect(notifSaves).toHaveLength(0);
    });
  });
});
