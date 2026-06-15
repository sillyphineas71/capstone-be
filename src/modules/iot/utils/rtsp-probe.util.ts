import * as net from 'net';

/**
 * probeTcp (IOT-014) — active TCP probe tới host:port.
 *
 * Mở được kết nối → 'online'; timeout/refuse/error → 'offline'.
 * Cam kết:
 *  - KHÔNG BAO GIỜ reject (mọi lỗi → 'offline') để 1 camera không làm hỏng cả lượt probe.
 *  - destroy() socket ở MỌI nhánh (connect/timeout/error) tránh rò file descriptor.
 *  - chỉ kiểm tra mở được TCP (v1), KHÔNG gửi/đọc RTSP payload.
 */
export function probeTcp(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<'online' | 'offline'> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: 'online' | 'offline', socket: net.Socket): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    try {
      const socket = net.createConnection({ host, port });
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish('online', socket));
      socket.once('timeout', () => finish('offline', socket));
      socket.once('error', () => finish('offline', socket));
    } catch {
      // createConnection ném đồng bộ (host/port không hợp lệ) → coi offline, KHÔNG reject.
      if (!settled) {
        settled = true;
        resolve('offline');
      }
    }
  });
}
