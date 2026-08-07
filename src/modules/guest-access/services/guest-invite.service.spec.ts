import {
  BadRequestException,
  ConflictException,
  GoneException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { GuestInviteService } from './guest-invite.service';
import { GuestAccessConfigService } from '../config/guest-access-config.service';
import { GuestAccessCacheService } from './guest-access-cache.service';
import { GuestInviteStatus } from '../constants/guest-access.constants';
import { MeetingStatus } from '../../meetings/entities/meeting.entity';
import {
  generateGuestInviteSecret,
  hashGuestInviteSecret,
} from '../utils/guest-invite-token.util';

describe('GuestInviteService', () => {
  let service: GuestInviteService;
  let findOne: jest.Mock;
  let find: jest.Mock;
  let query: jest.Mock;
  let dataSource: {
    getRepository: jest.Mock;
    manager: { query: jest.Mock };
  };
  let config: {
    getInviteLinkTtlHours: jest.Mock;
    getInviteBaseUrl: jest.Mock;
    getSessionMaxHours: jest.Mock;
  };
  let cache: {
    setInviteInvalidAfter: jest.Mock;
    getCurrentJti: jest.Mock;
    revokeSession: jest.Mock;
  };

  beforeEach(async () => {
    findOne = jest.fn();
    find = jest.fn().mockResolvedValue([]);
    query = jest.fn().mockResolvedValue(undefined);
    dataSource = {
      getRepository: jest.fn().mockReturnValue({ findOne, find }),
      manager: { query },
    };
    config = {
      getInviteLinkTtlHours: jest.fn().mockReturnValue(24),
      getInviteBaseUrl: jest
        .fn()
        .mockReturnValue('https://app.local/guest/join'),
      getSessionMaxHours: jest.fn().mockReturnValue(4),
    };
    cache = {
      setInviteInvalidAfter: jest.fn(),
      getCurrentJti: jest.fn().mockResolvedValue(null),
      revokeSession: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestInviteService,
        { provide: DataSource, useValue: dataSource },
        { provide: GuestAccessConfigService, useValue: config },
        { provide: GuestAccessCacheService, useValue: cache },
      ],
    }).compile();

    service = module.get(GuestInviteService);
  });

  describe('issueInvite', () => {
    it('should write guestInvite via jsonb_set with correct expiry and link', async () => {
      const meetingEndTime = new Date('2026-08-10T10:00:00Z');
      const manager = { query } as any;

      const result = await service.issueInvite(manager, {
        externalParticipantId: 'ep-1',
        email: 'guest@partner.com',
        meetingEndTime,
        issuedBy: 'host-1',
      });

      expect(result.email).toBe('guest@partner.com');
      expect(result.guestInvite.status).toBe(GuestInviteStatus.ACTIVE);
      expect(result.guestInvite.issuedBy).toBe('host-1');
      expect(new Date(result.guestInvite.expiresAt).getTime()).toBe(
        meetingEndTime.getTime() + 24 * 3600 * 1000,
      );
      expect(result.link).toBe(
        `https://app.local/guest/join/ep-1.${result.secret}`,
      );

      expect(query).toHaveBeenCalledWith(expect.stringContaining('jsonb_set'), [
        expect.stringContaining(result.guestInvite.tokenHash),
        'ep-1',
      ]);
    });
  });

  describe('resolveInvite', () => {
    const epId = '11111111-1111-1111-1111-111111111111';
    const secret = generateGuestInviteSecret();
    const token = `${epId}.${secret}`;
    const futureMeeting = {
      id: 'meeting-1',
      status: MeetingStatus.SCHEDULED,
      deletedAt: null,
    };

    function buildEp(overrides: Record<string, unknown> = {}) {
      return {
        id: epId,
        email: 'guest@partner.com',
        meeting: futureMeeting,
        metadataJson: {
          guestInvite: {
            tokenHash: hashGuestInviteSecret(secret),
            issuedAt: new Date().toISOString(),
            issuedBy: 'host-1',
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            status: GuestInviteStatus.ACTIVE,
            invalidAfter: null,
            firstJoinedAt: null,
            lastJoinedAt: null,
          },
        },
        ...overrides,
      };
    }

    it('should throw BadRequestException for malformed token (no dot)', async () => {
      await expect(service.resolveInvite('not-a-valid-token')).rejects.toThrow(
        BadRequestException,
      );
      expect(findOne).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when external participant does not exist (enumeration-safe)', async () => {
      findOne.mockResolvedValue(null);
      await expect(service.resolveInvite(token)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when no guestInvite metadata exists', async () => {
      findOne.mockResolvedValue(buildEp({ metadataJson: {} }));
      await expect(service.resolveInvite(token)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when secret does not match hash (same error as not-found)', async () => {
      findOne.mockResolvedValue(buildEp());
      const wrongToken = `${epId}.${generateGuestInviteSecret()}`;
      await expect(service.resolveInvite(wrongToken)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw GoneException when invite is revoked', async () => {
      findOne.mockResolvedValue(
        buildEp({
          metadataJson: {
            guestInvite: {
              tokenHash: hashGuestInviteSecret(secret),
              status: GuestInviteStatus.REVOKED,
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
              invalidAfter: null,
              issuedAt: new Date().toISOString(),
              issuedBy: 'host-1',
              firstJoinedAt: null,
              lastJoinedAt: null,
            },
          },
        }),
      );
      await expect(service.resolveInvite(token)).rejects.toThrow(GoneException);
    });

    it('should throw GoneException when invalidAfter has passed', async () => {
      findOne.mockResolvedValue(
        buildEp({
          metadataJson: {
            guestInvite: {
              tokenHash: hashGuestInviteSecret(secret),
              status: GuestInviteStatus.USED,
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
              invalidAfter: new Date(Date.now() - 1000).toISOString(),
              issuedAt: new Date().toISOString(),
              issuedBy: 'host-1',
              firstJoinedAt: null,
              lastJoinedAt: null,
            },
          },
        }),
      );
      await expect(service.resolveInvite(token)).rejects.toThrow(GoneException);
    });

    it('should throw GoneException when expired', async () => {
      findOne.mockResolvedValue(
        buildEp({
          metadataJson: {
            guestInvite: {
              tokenHash: hashGuestInviteSecret(secret),
              status: GuestInviteStatus.ACTIVE,
              expiresAt: new Date(Date.now() - 1000).toISOString(),
              invalidAfter: null,
              issuedAt: new Date().toISOString(),
              issuedBy: 'host-1',
              firstJoinedAt: null,
              lastJoinedAt: null,
            },
          },
        }),
      );
      await expect(service.resolveInvite(token)).rejects.toThrow(GoneException);
    });

    it('should throw ConflictException when meeting is cancelled', async () => {
      findOne.mockResolvedValue(
        buildEp({
          meeting: { ...futureMeeting, status: MeetingStatus.CANCELLED },
        }),
      );
      await expect(service.resolveInvite(token)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should resolve successfully for a valid, active, non-expired invite', async () => {
      findOne.mockResolvedValue(buildEp());
      const result = await service.resolveInvite(token);
      expect(result.externalParticipant.id).toBe(epId);
      expect(result.meeting.id).toBe('meeting-1');
      expect(result.guestInvite.status).toBe(GuestInviteStatus.ACTIVE);
    });
  });

  describe('markJoined', () => {
    it('should set status to used and set firstJoinedAt only on first call', async () => {
      findOne.mockResolvedValue({
        id: 'ep-1',
        metadataJson: {
          guestInvite: {
            tokenHash: 'hash',
            status: GuestInviteStatus.ACTIVE,
            expiresAt: new Date().toISOString(),
            invalidAfter: null,
            issuedAt: new Date().toISOString(),
            issuedBy: 'host-1',
            firstJoinedAt: null,
            lastJoinedAt: null,
          },
        },
      });

      await service.markJoined('ep-1');

      const [, params] = query.mock.calls[0];
      const written = JSON.parse(params[0]);
      expect(written.status).toBe(GuestInviteStatus.USED);
      expect(written.firstJoinedAt).not.toBeNull();
      expect(written.lastJoinedAt).not.toBeNull();
    });

    it('should be a no-op when no guestInvite metadata exists', async () => {
      findOne.mockResolvedValue({ id: 'ep-1', metadataJson: null });
      await service.markJoined('ep-1');
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('markRevoked', () => {
    it('should set status to revoked and set invalidAfter', async () => {
      findOne.mockResolvedValue({
        id: 'ep-1',
        metadataJson: {
          guestInvite: {
            tokenHash: 'hash',
            status: GuestInviteStatus.USED,
            expiresAt: new Date().toISOString(),
            invalidAfter: null,
            issuedAt: new Date().toISOString(),
            issuedBy: 'host-1',
            firstJoinedAt: new Date().toISOString(),
            lastJoinedAt: new Date().toISOString(),
          },
        },
      });

      await service.markRevoked('ep-1');

      const [, params] = query.mock.calls[0];
      const written = JSON.parse(params[0]);
      expect(written.status).toBe(GuestInviteStatus.REVOKED);
      expect(written.invalidAfter).not.toBeNull();
    });
  });

  describe('revokeAllForMeeting (FR-GLA-015, hook cho cancelMeeting/endMeeting)', () => {
    function epWithInvite(id: string, status: GuestInviteStatus) {
      return {
        id,
        metadataJson: {
          guestInvite: {
            tokenHash: 'hash',
            status,
            expiresAt: new Date().toISOString(),
            invalidAfter: null,
            issuedAt: new Date().toISOString(),
            issuedBy: 'host-1',
            firstJoinedAt: null,
            lastJoinedAt: null,
          },
        },
      };
    }

    it('should revoke every active/used invite of the meeting and return the count', async () => {
      find.mockResolvedValue([
        epWithInvite('ep-1', GuestInviteStatus.ACTIVE),
        epWithInvite('ep-2', GuestInviteStatus.USED),
      ]);
      findOne
        .mockResolvedValueOnce(epWithInvite('ep-1', GuestInviteStatus.ACTIVE)) // markRevoked internal lookup for ep-1
        .mockResolvedValueOnce(epWithInvite('ep-2', GuestInviteStatus.USED)); // for ep-2

      const count = await service.revokeAllForMeeting('meeting-1');

      expect(count).toBe(2);
      expect(cache.setInviteInvalidAfter).toHaveBeenCalledWith('ep-1');
      expect(cache.setInviteInvalidAfter).toHaveBeenCalledWith('ep-2');
    });

    it('should revoke the current session (jti) when one exists', async () => {
      find.mockResolvedValue([epWithInvite('ep-1', GuestInviteStatus.USED)]);
      findOne.mockResolvedValue(epWithInvite('ep-1', GuestInviteStatus.USED));
      cache.getCurrentJti.mockResolvedValue('jti-1');

      await service.revokeAllForMeeting('meeting-1');

      expect(cache.revokeSession).toHaveBeenCalledWith('jti-1', 4 * 3600);
    });

    it('should skip participants without a guestInvite (never issued)', async () => {
      find.mockResolvedValue([{ id: 'ep-1', metadataJson: null }]);

      const count = await service.revokeAllForMeeting('meeting-1');

      expect(count).toBe(0);
      expect(cache.setInviteInvalidAfter).not.toHaveBeenCalled();
    });

    it('should skip invites that are already revoked (idempotent)', async () => {
      find.mockResolvedValue([epWithInvite('ep-1', GuestInviteStatus.REVOKED)]);

      const count = await service.revokeAllForMeeting('meeting-1');

      expect(count).toBe(0);
      expect(cache.setInviteInvalidAfter).not.toHaveBeenCalled();
    });

    it('should return 0 for a meeting with no external participants', async () => {
      find.mockResolvedValue([]);
      const count = await service.revokeAllForMeeting('meeting-1');
      expect(count).toBe(0);
    });
  });
});
