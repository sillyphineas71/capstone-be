import express, { json } from 'express';
import request from 'supertest';

/**
 * [FIX 2026-08-17] E2E cho BODY_LIMIT ('main.ts:16') — 5mb (fix cu, commit
 * 8b7b6b2) van khong du: log that ghi nhan 413 tren event face_recognition
 * co anh base64 vuot 5MB. Dung lai 1 Express app toi gian voi CHINH XAC
 * cau hinh json({limit}) nhu main.ts (khong boot Nest/DB) — mirror pattern
 * cua test/iot/device-callback-timeout.e2e-spec.ts.
 *
 * '15mb' duoi day la GIA TRI THAT sau fix (main.ts:16) — khac voi
 * TEST_TIMEOUT_MS o file kia (chi mirror co che, khong can khop so that),
 * test nay CAN khop dung so that vi muc dich la xac nhan tran moi co hieu
 * luc dung nguong. Neu doi BODY_LIMIT o main.ts, phai doi lai gia tri nay.
 */
const BODY_LIMIT = '15mb';

describe('BODY_LIMIT (e2e — json body-parser limit, mirror main.ts)', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(json({ limit: BODY_LIMIT }));
    app.post('/api/v1/internal/ivss/events', (req, res) => {
      res.status(200).json({ success: true, received: true });
    });
  });

  it('payload ~500KB (ước lượng cũ, đúng comment gốc "JPEG ~100-500KB") → xử lý bình thường, KHÔNG đổi hành vi cũ', async () => {
    const imageBase64 = 'A'.repeat(500 * 1024);
    const res = await request(app)
      .post('/api/v1/internal/ivss/events')
      .send({ type: 'face_recognition', channelId: 1, imageBase64 })
      .expect(200);
    expect(res.body.success).toBe(true);
  });

  it('payload >5MB, <15MB (case 413 thật ghi nhận ở production) → giờ qua được, KHÔNG còn bị 413', async () => {
    const imageBase64 = 'A'.repeat(10 * 1024 * 1024); // 10MB > 5MB cũ, < 15MB mới
    const res = await request(app)
      .post('/api/v1/internal/ivss/events')
      .send({ type: 'face_recognition', channelId: 1, imageBase64 })
      .expect(200);
    expect(res.body.success).toBe(true);
  });

  it('payload vượt cả trần mới (>15MB) → VẪN bị 413 đúng cách — trần chống DoS chưa bị tắt hẳn', async () => {
    const imageBase64 = 'A'.repeat(16 * 1024 * 1024); // 16MB > 15mb limit
    await request(app)
      .post('/api/v1/internal/ivss/events')
      .send({ type: 'face_recognition', channelId: 1, imageBase64 })
      .expect(413);
  });
});
