import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NoShowConfirmTokenService } from './no-show-confirm-token.service.js';

const SECRET = 'test-no-show-confirm-link-secret-1234567890';

describe('NoShowConfirmTokenService (Việc B, Hướng 2)', () => {
  let service: NoShowConfirmTokenService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        NoShowConfirmTokenService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: unknown) =>
              key === 'NO_SHOW_CONFIRM_LINK_SECRET' ? SECRET : def,
          },
        },
      ],
    }).compile();
    service = module.get(NoShowConfirmTokenService);
    jwtService = module.get(JwtService);
  });

  it('sign/verify roundtrip: payload gồm đúng typ, caseId, userId', async () => {
    const token = await service.sign({ caseId: 'case-1', userId: 'user-1' });
    const payload = await service.verify(token);
    expect(payload.typ).toBe('no_show_confirm');
    expect(payload.caseId).toBe('case-1');
    expect(payload.userId).toBe('user-1');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('TTL = 3600s (60 phút) — độc lập, không lấy từ config nghiệp vụ', async () => {
    const token = await service.sign({ caseId: 'case-1', userId: 'user-1' });
    const payload = await service.verify(token);
    expect(payload.exp - payload.iat).toBe(3600);
  });

  it('token hết hạn → verify() reject (không phải lỗi lạ, throw có kiểm soát)', async () => {
    // Ký trực tiếp qua JwtService với expiresIn âm để có token đã hết hạn ngay lập tức.
    const expiredToken = await jwtService.signAsync(
      { typ: 'no_show_confirm', caseId: 'case-1', userId: 'user-1' },
      { secret: SECRET, expiresIn: -10 },
    );
    await expect(service.verify(expiredToken)).rejects.toThrow();
  });

  it('token bị sửa 1 ký tự (chữ ký sai) → verify() reject', async () => {
    const token = await service.sign({ caseId: 'case-1', userId: 'user-1' });
    const tampered = token.slice(0, -1) + (token.slice(-1) === 'a' ? 'b' : 'a');
    await expect(service.verify(tampered)).rejects.toThrow();
  });

  it('token ký bằng secret KHÁC (giả lập không biết NO_SHOW_CONFIRM_LINK_SECRET) → verify() reject', async () => {
    const foreignToken = await jwtService.signAsync(
      { typ: 'no_show_confirm', caseId: 'case-1', userId: 'user-1' },
      {
        secret: 'wrong-secret-attacker-does-not-know-real-one',
        expiresIn: 3600,
      },
    );
    await expect(service.verify(foreignToken)).rejects.toThrow();
  });

  it('token đúng chữ ký nhưng sai typ (vd token guest-access lỡ lọt vào) → verify() reject', async () => {
    const wrongTypeToken = await jwtService.signAsync(
      { typ: 'guest', caseId: 'case-1', userId: 'user-1' },
      { secret: SECRET, expiresIn: 3600 },
    );
    await expect(service.verify(wrongTypeToken)).rejects.toThrow();
  });

  it('buildLink: ghép đúng base URL + /no-show-confirm/:token, tự bỏ dấu / thừa cuối base', () => {
    expect(service.buildLink('https://api.example.com', 'tok123')).toBe(
      'https://api.example.com/no-show-confirm/tok123',
    );
    expect(service.buildLink('https://api.example.com/', 'tok123')).toBe(
      'https://api.example.com/no-show-confirm/tok123',
    );
  });
});
