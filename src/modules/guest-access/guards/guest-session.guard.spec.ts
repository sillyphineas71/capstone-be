import { UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GuestSessionGuard } from './guest-session.guard';
import { GuestSessionService } from '../services/guest-session.service';
import { GuestAccessCacheService } from '../services/guest-access-cache.service';

describe('GuestSessionGuard', () => {
  let guard: GuestSessionGuard;
  let sessionService: { verifyGuestToken: jest.Mock };
  let cache: { isSessionRevoked: jest.Mock; getInviteInvalidAfter: jest.Mock };

  beforeEach(async () => {
    sessionService = { verifyGuestToken: jest.fn() };
    cache = {
      isSessionRevoked: jest.fn().mockResolvedValue(false),
      getInviteInvalidAfter: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestSessionGuard,
        { provide: GuestSessionService, useValue: sessionService },
        { provide: GuestAccessCacheService, useValue: cache },
      ],
    }).compile();

    guard = module.get(GuestSessionGuard);
  });

  function buildContext(
    headers: Record<string, string>,
    params = {},
  ): {
    context: ExecutionContext;
    request: Record<string, unknown>;
  } {
    const request: Record<string, unknown> = { headers, params };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  it('should throw UnauthorizedException when no token is provided', async () => {
    const { context } = buildContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when token verification fails (wrong secret, employee token)', async () => {
    sessionService.verifyGuestToken.mockRejectedValue(
      new Error('invalid signature'),
    );
    const { context } = buildContext({ authorization: 'Bearer employee-jwt' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when session has been revoked', async () => {
    sessionService.verifyGuestToken.mockResolvedValue({
      sub: 'ep-1',
      mid: 'meeting-1',
      jti: 'jti-1',
      iat: 1000,
    });
    cache.isSessionRevoked.mockResolvedValue(true);
    const { context } = buildContext({ authorization: 'Bearer guest-jwt' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when issued before invalid_after marker', async () => {
    sessionService.verifyGuestToken.mockResolvedValue({
      sub: 'ep-1',
      mid: 'meeting-1',
      jti: 'jti-1',
      iat: 1000, // seconds
    });
    cache.isSessionRevoked.mockResolvedValue(false);
    cache.getInviteInvalidAfter.mockResolvedValue(1000 * 1000 + 500); // ms, after iat*1000
    const { context } = buildContext({ authorization: 'Bearer guest-jwt' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should assign request.guest and NOT request.user on success', async () => {
    sessionService.verifyGuestToken.mockResolvedValue({
      sub: 'ep-1',
      mid: 'meeting-1',
      jti: 'jti-1',
      iat: 1000,
    });
    const { context, request } = buildContext({
      authorization: 'Bearer guest-jwt',
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.guest).toEqual({
      externalParticipantId: 'ep-1',
      meetingId: 'meeting-1',
      jti: 'jti-1',
    });
    expect(request.user).toBeUndefined();
  });
});
