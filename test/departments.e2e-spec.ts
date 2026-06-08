import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module.js';

/**
 * Integration tests for POST /api/v1/departments.
 * Yêu cầu: test DB chạy, migration đã chạy, seed data có sẵn.
 *
 * Chạy: npx jest --config ./test/jest-e2e.json
 */

describe('POST /api/v1/departments (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

  const validPayload = {
    departmentCode: 'E2E_IT',
    departmentName: 'E2E Phòng Công nghệ thông tin',
  };

  const getAuthToken = (): string => {
    // TODO: lấy JWT token thực từ auth endpoint hoặc mock
    return 'Bearer <test-admin-token>';
  };

  describe('[AC-001] Happy path', () => {
    it('should create department and return 201 with 9 fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', getAuthToken())
        .send(validPayload)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.departmentCode).toBe('E2E_IT');
      expect(res.body.data.isActive).toBe(true);
      expect(res.body.data.createdAt).toBeDefined();
      expect(res.body.data.updatedAt).toBeDefined();
    });
  });

  describe('[AC-004→005] Validation errors', () => {
    it('should return 400 when departmentCode is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', getAuthToken())
        .send({ departmentName: 'Test' })
        .expect(400);
    });

    it('should return 400 when departmentName is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', getAuthToken())
        .send({ departmentCode: 'TEST' })
        .expect(400);
    });
  });

  describe('[AC-006] Format validation', () => {
    it('should return 422 for departmentCode with spaces', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', getAuthToken())
        .send({ departmentCode: 'INVALID CODE', departmentName: 'Test' })
        .expect(422);
    });
  });

  describe('[AC-012→013] Authorization', () => {
    it('should return 401 without token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/departments')
        .send(validPayload)
        .expect(401);
    });

    it('should return 403 without permission department.create', async () => {
      // TODO: dùng token của user không có permission department.create
      await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', 'Bearer <no-permission-token>')
        .send(validPayload)
        .expect(403);
    });
  });

  describe('[AC-014→015] Duplicate handling', () => {
    it('should return 409 for duplicate departmentCode', async () => {
      // Tạo department trước
      await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', getAuthToken())
        .send({ departmentCode: 'DUP_TEST', departmentName: 'Duplicate Test' });

      // Tạo lại với cùng code
      await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', getAuthToken())
        .send({ departmentCode: 'DUP_TEST', departmentName: 'Another Name' })
        .expect(409);
    });
  });
});
