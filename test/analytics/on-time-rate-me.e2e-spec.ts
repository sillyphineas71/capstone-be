import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';

import { OnTimeRateController } from '../../src/modules/analytics/controllers/on-time-rate.controller';
import { OnTimeRateService } from '../../src/modules/analytics/services/on-time-rate.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../src/modules/auth/guards/permissions.guard';
import { AuthConfigService } from '../../src/modules/auth/services/auth-config.service';
import { RedisService } from '../../src/modules/redis/redis.service';
import { AuthzReadRepository } from '../../src/modules/auth/repositories/authz-read.repository';

/**
 * [FIX 2026-08-13, R2] E2E cho GET /analytics/attendance/on-time-rate/me — chỉ boot đúng
 * OnTimeRateController + guard chain thật (JwtAuthGuard, PermissionsGuard), KHÔNG boot
 * AppModule/DB thật (mirror test/auth/logout.e2e-spec.ts — module scoped, không phải full app).
 * OnTimeRateService và AuthzReadRepository (đọc permission) được mock để không cần Postgres.
 * Mục tiêu: xác nhận đúng hành vi HTTP thật của guard chain (401 không JWT, 200 với JWT
 * EMPLOYEE dù không có quyền analytics.attendance.read) — business logic đã có unit test riêng.
 */
describe('GET /analytics/attendance/on-time-rate/me (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let authConfigService: AuthConfigService;
  let mockService: { getPersonalStats: jest.Mock };
  let mockAuthzRepo: { getEffectiveRolesAndPermissions: jest.Mock };

  const mockPersonalStatsResult = {
    data: {
      userId: 'emp-1',
      fullName: 'Nguyen Van A',
      email: 'a@co.com',
      employeeCode: 'EMP001',
      departmentName: 'Phong IT',
      avatarUrl: null,
      period: { from: '2026-06-01', to: '2026-06-30' },
      graceMinutes: 5,
      summary: {
        totalRequired: 0,
        onTimeCount: 0,
        lateCount: 0,
        absentCount: 0,
        onTimeRate: null,
        lateRate: null,
      },
      departmentAvg: null,
      trend: [],
      recentLate: [],
    },
    message: 'Thống kê chuyên cần cá nhân được truy xuất thành công',
  };

  beforeAll(async () => {
    mockService = {
      getPersonalStats: jest.fn().mockResolvedValue(mockPersonalStatsResult),
    };
    mockAuthzRepo = {
      // EMPLOYEE, KHÔNG có analytics.attendance.read — đúng thực trạng seed hiện tại.
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: ['EMPLOYEE'], permissions: [] }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({})],
      controllers: [OnTimeRateController],
      providers: [
        { provide: OnTimeRateService, useValue: mockService },
        JwtAuthGuard,
        PermissionsGuard,
        AuthConfigService,
        { provide: RedisService, useValue: { exists: async () => false, get: async () => null } },
        { provide: AuthzReadRepository, useValue: mockAuthzRepo },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    jwtService = moduleFixture.get(JwtService);
    authConfigService = moduleFixture.get(AuthConfigService);
  });

  afterAll(async () => {
    await app.close();
  });

  const signToken = async (userId: string) =>
    jwtService.signAsync(
      { sub: userId },
      { secret: authConfigService.getAccessTokenSecret(), expiresIn: '1h' },
    );

  it('không có JWT -> 401', async () => {
    await request(app.getHttpServer())
      .get('/analytics/attendance/on-time-rate/me')
      .expect(401);
  });

  it('JWT hợp lệ (role EMPLOYEE, không có analytics.attendance.read) -> 200 — không bị chặn bởi permission cũ', async () => {
    const token = await signToken('emp-1');

    const res = await request(app.getHttpServer())
      .get('/analytics/attendance/on-time-rate/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.userId).toBe('emp-1');
    // Service được gọi với currentUser lấy từ JWT (sub), không phải từ query/param nào.
    expect(mockService.getPersonalStats).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'emp-1' }),
      expect.any(Object),
    );
  });
});
