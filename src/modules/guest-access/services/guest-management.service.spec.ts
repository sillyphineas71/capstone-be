import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { GuestManagementService } from './guest-management.service';
import { GuestInviteService } from './guest-invite.service';
import { GuestEmailService } from './guest-email.service';
import { GuestLobbyService } from './guest-lobby.service';
import { GuestAccessCacheService } from './guest-access-cache.service';
import { GuestAccessConfigService } from '../config/guest-access-config.service';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service';
import { MeetingEntity } from '../../meetings/entities/meeting.entity';
import { MeetingExternalParticipantEntity } from '../../meetings/entities/meeting-external-participant.entity';
import { UserEntity } from '../../accounts/entities/user.entity';

describe('GuestManagementService', () => {
  let service: GuestManagementService;
  let meetingFindOne: jest.Mock;
  let epFindOne: jest.Mock;
  let epFind: jest.Mock;
  let userFindOne: jest.Mock;
  let dataSource: { getRepository: jest.Mock; manager: unknown };
  let guestInviteService: {
    issueInvite: jest.Mock;
    markRevoked: jest.Mock;
  };
  let guestEmailService: { sendInviteLink: jest.Mock };
  let guestLobbyService: {
    admit: jest.Mock;
    reject: jest.Mock;
    listWaiting: jest.Mock;
  };
  let cache: {
    getLobbyStatus: jest.Mock;
    getCurrentJti: jest.Mock;
    revokeSession: jest.Mock;
    setInviteInvalidAfter: jest.Mock;
  };
  let config: { getSessionMaxHours: jest.Mock };
  let authzReadRepository: { getEffectiveRolesAndPermissions: jest.Mock };
  let auditLogsService: { logAction: jest.Mock };

  const meeting = {
    id: 'meeting-1',
    hostId: 'host-1',
    title: 'Weekly Sync',
    startTime: new Date(),
    endTime: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    meetingFindOne = jest.fn().mockResolvedValue(meeting);
    epFindOne = jest.fn().mockResolvedValue({
      id: 'ep-1',
      email: 'guest@partner.com',
      meetingId: 'meeting-1',
    });
    epFind = jest.fn().mockResolvedValue([]);
    userFindOne = jest.fn().mockResolvedValue({ fullName: 'Host Nguyen' });

    dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === MeetingEntity) return { findOne: meetingFindOne };
        if (entity === MeetingExternalParticipantEntity)
          return { findOne: epFindOne, find: epFind };
        if (entity === UserEntity) return { findOne: userFindOne };
        throw new Error('unexpected entity');
      }),
      manager: {},
    };

    guestInviteService = {
      issueInvite: jest.fn().mockResolvedValue({
        email: 'guest@partner.com',
        link: 'https://app.local/guest/join/ep-1.newsecret',
      }),
      markRevoked: jest.fn(),
    };
    guestEmailService = { sendInviteLink: jest.fn() };
    guestLobbyService = {
      admit: jest.fn(),
      reject: jest.fn(),
      listWaiting: jest.fn().mockResolvedValue(['ep-1']),
    };
    cache = {
      getLobbyStatus: jest.fn().mockResolvedValue('waiting'),
      getCurrentJti: jest.fn().mockResolvedValue(null),
      revokeSession: jest.fn(),
      setInviteInvalidAfter: jest.fn(),
    };
    config = { getSessionMaxHours: jest.fn().mockReturnValue(4) };
    authzReadRepository = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: [], permissions: [] }),
    };
    auditLogsService = { logAction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestManagementService,
        { provide: DataSource, useValue: dataSource },
        { provide: GuestInviteService, useValue: guestInviteService },
        { provide: GuestEmailService, useValue: guestEmailService },
        { provide: GuestLobbyService, useValue: guestLobbyService },
        { provide: GuestAccessCacheService, useValue: cache },
        { provide: GuestAccessConfigService, useValue: config },
        { provide: AuthzReadRepository, useValue: authzReadRepository },
        { provide: AuditLogsService, useValue: auditLogsService },
      ],
    }).compile();

    service = module.get(GuestManagementService);
  });

  describe('ownership-or-admin', () => {
    it('should allow the meeting host', async () => {
      await expect(
        service.listGuests('meeting-1', 'host-1'),
      ).resolves.toBeDefined();
    });

    it('should allow SYSTEM_ADMIN/BUSINESS_ADMIN even when not the host', async () => {
      authzReadRepository.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: [],
      });
      await expect(
        service.listGuests('meeting-1', 'someone-else'),
      ).resolves.toBeDefined();
    });

    it('should throw ForbiddenException for a non-host, non-admin caller (NOT_MEETING_HOST)', async () => {
      await expect(
        service.listGuests('meeting-1', 'random-employee'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when the meeting does not exist', async () => {
      meetingFindOne.mockResolvedValue(null);
      await expect(service.listGuests('meeting-1', 'host-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listGuests', () => {
    it('should return a summary with inviteStatus=not_invited when no guestInvite exists', async () => {
      epFind.mockResolvedValue([
        {
          id: 'ep-1',
          fullName: 'Khach A',
          organizationName: 'Org',
          email: 'a@b.com',
          metadataJson: null,
        },
      ]);
      const result = await service.listGuests('meeting-1', 'host-1');
      expect(result[0].inviteStatus).toBe('not_invited');
    });

    it('should surface the guestInvite status when present', async () => {
      epFind.mockResolvedValue([
        {
          id: 'ep-1',
          fullName: 'Khach A',
          organizationName: 'Org',
          email: 'a@b.com',
          metadataJson: { guestInvite: { status: 'used' } },
        },
      ]);
      const result = await service.listGuests('meeting-1', 'host-1');
      expect(result[0].inviteStatus).toBe('used');
    });
  });

  describe('admit / reject', () => {
    it('admit should delegate to GuestLobbyService and write an audit log', async () => {
      await service.admit('meeting-1', 'ep-1', 'host-1');
      expect(guestLobbyService.admit).toHaveBeenCalledWith('meeting-1', 'ep-1');
      expect(auditLogsService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'guest_admitted',
          userId: 'host-1',
        }),
      );
    });

    it('reject should delegate to GuestLobbyService with the configured session TTL', async () => {
      await service.reject('meeting-1', 'ep-1', 'host-1');
      expect(guestLobbyService.reject).toHaveBeenCalledWith(
        'meeting-1',
        'ep-1',
        4 * 3600,
      );
    });

    it('non-host should be rejected before reaching GuestLobbyService', async () => {
      await expect(
        service.admit('meeting-1', 'ep-1', 'random-employee'),
      ).rejects.toThrow(ForbiddenException);
      expect(guestLobbyService.admit).not.toHaveBeenCalled();
    });
  });

  describe('resendInvite', () => {
    it('should issue a new invite, send the new link, and revoke the previous session', async () => {
      cache.getCurrentJti.mockResolvedValue('old-jti');

      await service.resendInvite('meeting-1', 'ep-1', 'host-1');

      expect(cache.revokeSession).toHaveBeenCalledWith('old-jti', 4 * 3600);
      expect(guestInviteService.issueInvite).toHaveBeenCalled();
      expect(guestEmailService.sendInviteLink).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'guest@partner.com',
          link: 'https://app.local/guest/join/ep-1.newsecret',
        }),
      );
      expect(auditLogsService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'guest_invite_resent' }),
      );
    });

    it('should throw NotFoundException when the external participant has no email (GUEST_EMAIL_MISSING)', async () => {
      epFindOne.mockResolvedValue({ id: 'ep-1', email: null });
      await expect(
        service.resendInvite('meeting-1', 'ep-1', 'host-1'),
      ).rejects.toThrow(NotFoundException);
      expect(guestInviteService.issueInvite).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the external participant does not belong to this meeting', async () => {
      epFindOne.mockResolvedValue(null);
      await expect(
        service.resendInvite('meeting-1', 'ep-1', 'host-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('revokeAccess', () => {
    it('should set invalid_after, revoke the current session, and mark the invite revoked', async () => {
      cache.getCurrentJti.mockResolvedValue('jti-1');
      await service.revokeAccess('meeting-1', 'ep-1', 'host-1');

      expect(cache.setInviteInvalidAfter).toHaveBeenCalledWith('ep-1');
      expect(cache.revokeSession).toHaveBeenCalledWith('jti-1', 4 * 3600);
      expect(guestInviteService.markRevoked).toHaveBeenCalledWith('ep-1');
      expect(auditLogsService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'guest_access_revoked' }),
      );
    });
  });
});
