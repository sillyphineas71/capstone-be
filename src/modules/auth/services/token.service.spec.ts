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
});
