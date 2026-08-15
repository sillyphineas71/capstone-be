import * as http from 'http';
import * as net from 'net';
import express, { json } from 'express';
import request from 'supertest';
import { deviceCallbackTimeout } from '../../src/config/device-callback-timeout.middleware';

/**
 * [FIX 2026-08-15] E2E thật cho middleware timeout route callback thiết bị (/vf,/hb,/sf).
 * Dựng lại ĐÚNG thứ tự middleware như main.ts (timeout middleware TRƯỚC json()) trên 1
 * Express app tối giản — KHÔNG cần boot toàn bộ Nest/DB. Dùng timeoutMs NGẮN (300ms) thay
 * vì 15000ms thật để test nhanh — cùng 1 hàm `deviceCallbackTimeout`, chỉ khác tham số.
 */
describe('deviceCallbackTimeout (e2e — request treo thật qua raw socket)', () => {
  let app: express.Express;
  let server: http.Server;
  let port: number;
  const TEST_TIMEOUT_MS = 300;

  beforeAll((done) => {
    app = express();
    app.use('/api/v1/vf', deviceCallbackTimeout(TEST_TIMEOUT_MS));
    app.use(json({ limit: '1mb' }));
    app.post('/api/v1/vf/:deviceCode/:callbackToken', (req, res) => {
      res.status(200).json({ success: true, received: req.body });
    });
    server = app.listen(0, () => {
      port = (server.address() as net.AddressInfo).port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  it('request bình thường (body đầy đủ, đúng Content-Length) → xử lý y hệt trước, KHÔNG bị ảnh hưởng', async () => {
    const res = await request(app)
      .post('/api/v1/vf/a/tok123')
      .send({ operator: 'VerifyPush', info: { PersonID: 92 } })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.received.operator).toBe('VerifyPush');
  });

  it('request treo thật (Content-Length khai lớn hơn số byte thực gửi, không gửi hết) → PHẢI timeout đúng thời gian cấu hình, trả 408 kèm log, KHÔNG treo vô hạn', (done) => {
    const fullBody = JSON.stringify({
      operator: 'VerifyPush',
      info: { PersonID: 92 },
    });
    // Khai Content-Length LỚN HƠN thực tế gửi — mô phỏng đúng lỗi framing đã nghi ngờ
    // (thiết bị gửi thiếu byte so với header đã khai).
    const declaredLength = fullBody.length + 500;
    const partialBody = fullBody.slice(0, 10); // chỉ gửi 10 byte đầu, KHÔNG gửi hết, KHÔNG end().

    const startedAt = Date.now();
    const socket = net.createConnection(port, '127.0.0.1', () => {
      socket.write(
        `POST /api/v1/vf/a/tok123 HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          `Content-Type: application/json\r\n` +
          `Content-Length: ${declaredLength}\r\n` +
          `Connection: keep-alive\r\n\r\n` +
          partialBody,
        // KHÔNG gọi socket.end() — mô phỏng kết nối treo, thiếu byte.
      );
    });

    let rawResponse = '';
    socket.on('data', (chunk) => {
      rawResponse += chunk.toString();
    });

    // Bound-check: PHẢI có phản hồi trong khoảng [timeout đã cấu hình, timeout + biên độ an
    // toàn] — không được hoàn toàn không phản hồi (treo vô hạn, test cũ trước fix sẽ timeout
    // ở mức Jest's default 5s mà KHÔNG có response nào — đúng triệu chứng bug gốc).
    socket.on('data', () => {
      const elapsedMs = Date.now() - startedAt;
      try {
        expect(rawResponse).toContain('408');
        expect(rawResponse.toLowerCase()).toContain('device_callback_timeout');
        expect(elapsedMs).toBeGreaterThanOrEqual(TEST_TIMEOUT_MS);
        expect(elapsedMs).toBeLessThan(TEST_TIMEOUT_MS + 2000); // biên độ an toàn, không phải treo mãi
        socket.destroy();
        done();
      } catch (err) {
        socket.destroy();
        done(err);
      }
    });

    socket.on('error', () => {
      // Socket có thể bị server chủ động destroy sau khi trả 408 — không coi là fail nếu
      // response đã nhận được đủ trước đó (assertion ở nhánh 'data' đã chạy trước rồi).
    });
  }, 10000);
});
