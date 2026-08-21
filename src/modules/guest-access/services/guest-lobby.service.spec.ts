import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { GuestLobbyService } from './guest-lobby.service';
import { GuestAccessCacheService } from './guest-access-cache.service';
import { GuestAccessConfigService } from '../config/guest-access-config.service';
import { GuestLobbyStatus } from '../constants/guest-access.constants';

describe('GuestLobbyService', () => {
  let service: GuestLobbyService;
  let findOne: jest.Mock;
  let dataSource: { getRepository: jest.Mock };
  let cache: {
    addToLobby: jest.Mock;
    setLobbyStatus: jest.Mock;
    getLobbyStatus: jest.Mock;
    listLobby: jest.Mock;
    removeFromLobby: jest.Mock;
    getCurrentJti: jest.Mock;
    revokeSession: jest.Mock;
  };
  let config: { getLobbyEnabledDefault: jest.Mock };

  beforeEach(async () => {
    findOne = jest.fn().mockResolvedValue(null);
    dataSource = { getRepository: jest.fn().mockReturnValue({ findOne }) };
    cache = {
      addToLobby: jest.fn(),
      setLobbyStatus: jest.fn(),
      getLobbyStatus: jest.fn(),
      listLobby: jest.fn(),
      removeFromLobby: jest.fn(),
      getCurrentJti: jest.fn(),
      revokeSession: jest.fn(),
    };
    config = { getLobbyEnabledDefault: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestLobbyService,
        { provide: DataSource, useValue: dataSource },
        { provide: GuestAccessCacheService, useValue: cache },
        { provide: GuestAccessConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(GuestLobbyService);
  });

  describe('isLobbyEnabled precedence: meeting override > global > env default', () => {
    it('should use the meeting-specific override when present', async () => {
      findOne.mockResolvedValueOnce({ configValue: 'false' }); // override
      const result = await service.isLobbyEnabled('meeting-1');
      expect(result).toBe(false);
      expect(findOne).toHaveBeenCalledTimes(1);
    });

    it('should fall back to the global system_configs value when no override exists', async () => {
      findOne
        .mockResolvedValueOnce(null) // no override
        .mockResolvedValueOnce({ configValue: 'false' }); // global
      const result = await service.isLobbyEnabled('meeting-1');
      expect(result).toBe(false);
    });

    it('should fall back to env default when neither override nor global config exists', async () => {
      findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      config.getLobbyEnabledDefault.mockReturnValue(true);
      const result = await service.isLobbyEnabled('meeting-1');
      expect(result).toBe(true);
    });
  });

  describe('enqueue / admitDirectly', () => {
    it('enqueue should add to lobby (Redis SET)', async () => {
      await service.enqueue('meeting-1', 'ep-1');
      expect(cache.addToLobby).toHaveBeenCalledWith('meeting-1', 'ep-1');
    });

    it('admitDirectly should bypass lobby and set status admitted', async () => {
      await service.admitDirectly('ep-1');
      expect(cache.setLobbyStatus).toHaveBeenCalledWith(
        'ep-1',
        GuestLobbyStatus.ADMITTED,
      );
    });
  });

  describe('admit / reject', () => {
    it('admit should remove from lobby and set status admitted', async () => {
      await service.admit('meeting-1', 'ep-1');
      expect(cache.removeFromLobby).toHaveBeenCalledWith('meeting-1', 'ep-1');
      expect(cache.setLobbyStatus).toHaveBeenCalledWith(
        'ep-1',
        GuestLobbyStatus.ADMITTED,
      );
    });

    it('reject should set status rejected and revoke the current session if one exists', async () => {
      cache.getCurrentJti.mockResolvedValue('jti-1');
      await service.reject('meeting-1', 'ep-1', 3600);
      expect(cache.setLobbyStatus).toHaveBeenCalledWith(
        'ep-1',
        GuestLobbyStatus.REJECTED,
      );
      expect(cache.revokeSession).toHaveBeenCalledWith('jti-1', 3600);
    });

    it('reject should NOT try to revoke a session when none exists', async () => {
      cache.getCurrentJti.mockResolvedValue(null);
      await service.reject('meeting-1', 'ep-1', 3600);
      expect(cache.revokeSession).not.toHaveBeenCalled();
    });
  });

  describe('getStatusWithAutoAdmit', () => {
    it('should auto-admit a waiting guest once the meeting start time has passed', async () => {
      cache.getLobbyStatus.mockResolvedValue(GuestLobbyStatus.WAITING);
      const pastStart = new Date(Date.now() - 60_000);

      const result = await service.getStatusWithAutoAdmit(
        'meeting-1',
        'ep-1',
        pastStart,
      );

      expect(result).toBe(GuestLobbyStatus.ADMITTED);
      expect(cache.removeFromLobby).toHaveBeenCalledWith('meeting-1', 'ep-1');
      expect(cache.setLobbyStatus).toHaveBeenCalledWith(
        'ep-1',
        GuestLobbyStatus.ADMITTED,
      );
    });

    it('should keep a guest waiting when the meeting has not started yet', async () => {
      cache.getLobbyStatus.mockResolvedValue(GuestLobbyStatus.WAITING);
      const futureStart = new Date(Date.now() + 60_000);

      const result = await service.getStatusWithAutoAdmit(
        'meeting-1',
        'ep-1',
        futureStart,
      );

      expect(result).toBe(GuestLobbyStatus.WAITING);
      expect(cache.setLobbyStatus).not.toHaveBeenCalled();
    });

    it('should not touch an already-admitted or rejected guest', async () => {
      cache.getLobbyStatus.mockResolvedValue(GuestLobbyStatus.REJECTED);
      const pastStart = new Date(Date.now() - 60_000);

      const result = await service.getStatusWithAutoAdmit(
        'meeting-1',
        'ep-1',
        pastStart,
      );

      expect(result).toBe(GuestLobbyStatus.REJECTED);
      expect(cache.setLobbyStatus).not.toHaveBeenCalled();
    });

    it('should treat an undefined meeting start time as not-yet-started', async () => {
      cache.getLobbyStatus.mockResolvedValue(GuestLobbyStatus.WAITING);

      const result = await service.getStatusWithAutoAdmit(
        'meeting-1',
        'ep-1',
        undefined,
      );

      expect(result).toBe(GuestLobbyStatus.WAITING);
      expect(cache.setLobbyStatus).not.toHaveBeenCalled();
    });
  });

  describe('assertAdmitted', () => {
    it('should throw ForbiddenException (GUEST_LOBBY_PENDING) when waiting', () => {
      expect(() => service.assertAdmitted(GuestLobbyStatus.WAITING)).toThrow(
        ForbiddenException,
      );
    });

    it('should throw UnauthorizedException when rejected', () => {
      expect(() => service.assertAdmitted(GuestLobbyStatus.REJECTED)).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when status is null (fail-closed, NFR-GLA-009)', () => {
      expect(() => service.assertAdmitted(null)).toThrow(UnauthorizedException);
    });

    it('should NOT throw when admitted', () => {
      expect(() =>
        service.assertAdmitted(GuestLobbyStatus.ADMITTED),
      ).not.toThrow();
    });
  });
});
