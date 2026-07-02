import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module.js';

/**
 * E2E test cho GET /api/v1/background-jobs/:id (T007 — poll trạng thái job).
 *
 * Yêu cầu hạ tầng (giống các e2e khác trong repo này, vd departments.e2e-spec.ts):
 * test DB + Redis chạy, migration đã chạy, seed data có sẵn, và CÓ token JWT
 * thật. Repo hiện chưa có helper sinh token e2e (các file e2e khác đang để
 * placeholder `Bearer <...-token>` dạng TODO) — file này theo đúng pattern đó,
 * sẽ chạy xanh khi hạ tầng + helper token sẵn sàng. Logic authorization
 * (owner/admin), not-found, status mapping đã được phủ đầy đủ bằng unit test
 * runnable-ngay ở `src/modules/administration/services/background-jobs.service.spec.ts`.
 *
 * Chạy: npx jest --config ./test/jest-e2e.json
 */
describe('GET /api/v1/background-jobs/:id (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // TODO: thay bằng helper sinh JWT thật của owner job + của admin + của user lạ.
  const ownerToken = (): string => 'Bearer <owner-token>';
  const strangerToken = (): string => 'Bearer <stranger-token>';

  // TODO: seed/tạo 1 transcription job và lấy jobId thật trước khi assert.
  const A_VALID_JOB_ID = '00000000-0000-0000-0000-000000000000';
  const A_RANDOM_UUID = '11111111-1111-1111-1111-111111111111';

  describe('Authorization', () => {
    it('401 khi không có token', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/background-jobs/${A_VALID_JOB_ID}`)
        .expect(401);
    });

    it('403 khi user không phải owner và không phải admin', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/background-jobs/${A_VALID_JOB_ID}`)
        .set('Authorization', strangerToken())
        .expect(403);
    });
  });

  describe('Happy path / errors', () => {
    it('400 khi id không phải UUID hợp lệ (ParseUUIDPipe)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/background-jobs/not-a-uuid')
        .set('Authorization', ownerToken())
        .expect(400);
    });

    it('404 khi job không tồn tại', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/background-jobs/${A_RANDOM_UUID}`)
        .set('Authorization', ownerToken())
        .expect(404);
    });

    it('200 + status field khi owner poll job của mình', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/background-jobs/${A_VALID_JOB_ID}`)
        .set('Authorization', ownerToken())
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.jobId).toBe(A_VALID_JOB_ID);
      expect(res.body.data.status).toBeDefined();
      // Không leak field nội bộ
      expect(res.body.data.requestedBy).toBeUndefined();
      expect(res.body.data.inputJson).toBeUndefined();
    });
  });
});
