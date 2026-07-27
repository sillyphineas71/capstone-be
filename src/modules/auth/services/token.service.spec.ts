import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthConfigService } from './auth-config.service';
import { TokenService } from './token.service';

describe('TokenService', () => {
  it('hashes refresh token deterministically', () => {
    const authConfigService = new AuthConfigService({
      get: jest.fn((_: string, defaultValue: number) => defaultValue),
    } as unknown as ConfigService);
    const service = new TokenService(new JwtService(), authConfigService);

    expect(service.hashRefreshToken('abc')).toHaveLength(64);
  });

  it('generates refresh token signed with AuthConfigService.getRefreshTokenSecret() (khong con doc thang process.env)', async () => {
    const authConfigService = new AuthConfigService({
      get: jest.fn((key: string) => {
        if (key === 'AUTH_REFRESH_TOKEN_SECRET')
          return 'configured-refresh-secret';
        if (key === 'AUTH_REFRESH_TOKEN_TTL_SECONDS') return 2592000;
        return undefined;
      }),
    } as unknown as ConfigService);

    const jwtService = new JwtService();
    const signAsyncSpy = jest
      .spyOn(jwtService, 'signAsync')
      .mockResolvedValue('signed-refresh-token');

    const service = new TokenService(jwtService, authConfigService);
    await service.generateRefreshToken({ sub: 'user-1', jti: 'jti-1' });

    expect(signAsyncSpy).toHaveBeenCalledWith(
      { sub: 'user-1', jti: 'jti-1' },
      expect.objectContaining({ secret: 'configured-refresh-secret' }),
    );
  });
});
