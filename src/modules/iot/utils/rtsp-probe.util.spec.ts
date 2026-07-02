import * as net from 'net';
import { probeTcp } from './rtsp-probe.util.js';

describe('probeTcp (IOT-014)', () => {
  it('online: connect thành công tới server đang listen', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const port = (server.address() as net.AddressInfo).port;

    const result = await probeTcp('127.0.0.1', port, 2000);
    expect(result).toBe('online');

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('offline: cổng đóng (refuse) → offline', async () => {
    // Lấy 1 cổng rồi đóng ngay để chắc chắn không ai listen.
    const server = net.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const result = await probeTcp('127.0.0.1', port, 2000);
    expect(result).toBe('offline');
  });

  it('timeout/unreachable: host không route (TEST-NET-1) → offline', async () => {
    // 192.0.2.0/24 (RFC5737 TEST-NET-1) bảo đảm không route → connect treo tới timeout
    // (hoặc error EHOSTUNREACH); cả hai nhánh đều trả 'offline'. Timeout ngắn, không flaky.
    const result = await probeTcp('192.0.2.1', 554, 300);
    expect(result).toBe('offline');
  });

  it('never reject: port không hợp lệ → createConnection ném đồng bộ → offline', async () => {
    // net.createConnection ném RangeError (ERR_SOCKET_BAD_PORT) đồng bộ với port ngoài 0..65535.
    await expect(probeTcp('127.0.0.1', 999999, 50)).resolves.toBe('offline');
  });
});
