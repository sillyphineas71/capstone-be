/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { EventEmitter } from 'events';
import { deviceCallbackTimeout } from './device-callback-timeout.middleware.js';

function fakeReq(overrides: Partial<any> = {}) {
  const req: any = new EventEmitter();
  req.method = 'POST';
  req.originalUrl = '/api/v1/vf/a/SUPER_SECRET_TOKEN';
  req.path = '/api/v1/vf/a/SUPER_SECRET_TOKEN';
  req.ip = '192.168.1.11';
  req.socket = { remoteAddress: '192.168.1.11', destroy: jest.fn() };
  req.setTimeout = jest.fn();
  Object.assign(req, overrides);
  return req;
}

function fakeRes() {
  const res: any = new EventEmitter();
  res.headersSent = false;
  res.status = jest.fn().mockReturnThis();
  res.json = jest.fn().mockImplementation(() => {
    res.headersSent = true;
    // Mô phỏng đúng Express thật: res.json() → res.end() → cuối cùng bắn 'finish'.
    res.emit('finish');
    return res;
  });
  return res;
}

describe('deviceCallbackTimeout middleware', () => {
  afterEach(() => jest.restoreAllMocks());

  it('luôn gọi next() ngay lập tức, không chặn request bình thường', () => {
    const req = fakeReq();
    const res = fakeRes();
    const next = jest.fn();
    deviceCallbackTimeout(15000)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('set đúng timeout (ms) trên request', () => {
    const req = fakeReq();
    const res = fakeRes();
    deviceCallbackTimeout(15000)(req, res, jest.fn());
    expect(req.setTimeout).toHaveBeenCalledWith(15000, expect.any(Function));
  });

  it('request hoàn tất trước timeout (res "finish") → callback timeout KHÔNG được gọi tự động, nhưng nếu Node vẫn gọi (race hiếm) thì middleware phải tự bỏ qua vì res đã headersSent giả lập', () => {
    const req = fakeReq();
    const res = fakeRes();
    deviceCallbackTimeout(15000)(req, res, jest.fn());
    const onTimeout = req.setTimeout.mock.calls[0][1];

    // Mô phỏng response đã hoàn tất bình thường trước khi timeout kịp bắn.
    res.json({ success: true });

    onTimeout(); // dù bị gọi trễ, middleware phải no-op vì đã settled.
    expect(res.status).not.toHaveBeenCalled();
    expect(req.socket.destroy).not.toHaveBeenCalled();
  });

  it('timeout kích hoạt (chưa có response) → log WARN + trả 408 + error code DEVICE_CALLBACK_TIMEOUT + destroy socket', () => {
    const req = fakeReq();
    const res = fakeRes();
    deviceCallbackTimeout(15000)(req, res, jest.fn());
    const onTimeout = req.setTimeout.mock.calls[0][1];

    onTimeout();

    expect(res.status).toHaveBeenCalledWith(408);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'DEVICE_CALLBACK_TIMEOUT' }),
      }),
    );
    expect(req.socket.destroy).toHaveBeenCalled();
  });

  it('timeout kích hoạt 2 lần liên tiếp (race) → chỉ trả response 1 lần', () => {
    const req = fakeReq();
    const res = fakeRes();
    deviceCallbackTimeout(15000)(req, res, jest.fn());
    const onTimeout = req.setTimeout.mock.calls[0][1];

    onTimeout();
    onTimeout();

    expect(res.status).toHaveBeenCalledTimes(1);
  });

  it('log không lộ callback_token — path bị che ở segment token', () => {
    const logSpy = jest.spyOn(
      require('@nestjs/common').Logger.prototype,
      'warn',
    );
    const req = fakeReq({
      originalUrl: '/api/v1/vf/a/SUPER_SECRET_TOKEN',
    });
    const res = fakeRes();
    deviceCallbackTimeout(15000)(req, res, jest.fn());
    const onTimeout = req.setTimeout.mock.calls[0][1];
    onTimeout();

    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('SUPER_SECRET_TOKEN');
    expect(logged).toContain('/api/v1/vf/a/***');
  });

  it('route /hb gốc (không có deviceCode/token) → path log giữ nguyên, không che nhầm', () => {
    const logSpy = jest.spyOn(
      require('@nestjs/common').Logger.prototype,
      'warn',
    );
    const req = fakeReq({ originalUrl: '/api/v1/hb', path: '/api/v1/hb' });
    const res = fakeRes();
    deviceCallbackTimeout(15000)(req, res, jest.fn());
    const onTimeout = req.setTimeout.mock.calls[0][1];
    onTimeout();

    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('/api/v1/hb');
  });
});
