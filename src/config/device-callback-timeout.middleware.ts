import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * DeviceCallbackTimeoutMiddleware — timeout tường minh riêng cho 3 route callback
 * thiết bị (/vf, /hb, /sf — VerifyShortDeviceCallbacksController/ShortDeviceCallbacksController/
 * StrangerShortDeviceCallbacksController).
 *
 * [FIX 2026-08-15] Trước đây KHÔNG có timeout nào ở tầng Express/Node cho các route này —
 * nếu thiết bị gửi body không khớp Content-Length đã khai (thiếu byte), body-parser
 * (json()/urlencoded(), đăng ký global trong main.ts) sẽ ĐỢI VÔ THỜI HẠN phần còn thiếu —
 * KHÔNG throw, KHÔNG log, request treo im lặng (đã xác nhận qua recon, khớp đúng triệu
 * chứng "đợi >1 phút vẫn không có gì" của lỗi verify callback chập chờn).
 *
 * Đặt timeout Ở ĐÂY (middleware, đăng ký TRƯỚC json()/urlencoded() trong main.ts, scope
 * theo path /vf|/hb|/sf) — KHÔNG đặt trong controller handler — vì hang xảy ra NGAY TRONG
 * lúc body-parser đang đọc stream, TRƯỚC KHI request lifecycle của Nest (guard/interceptor/
 * handler) từng được gọi tới; req.setTimeout() trong handler sẽ không bao giờ chạy được vì
 * handler chưa từng bắt đầu. req.setTimeout() ở đây set timeout trên socket gốc — vẫn có
 * hiệu lực dù middleware/body-parser nào đang "giữ" request tại thời điểm đó.
 *
 * KHÔNG đụng receiveVerifyEvent()/receiveHeartbeat()/parseVerifyPayload() — chỉ bọc ngoài.
 */

const logger = new Logger('DeviceCallbackTimeout');

/** Che token trong path khi log (SEC-01) — path dạng /api/v1/<vf|hb|sf>/:deviceCode/:callbackToken. */
function redactCallbackTokenInPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  if (segments.length >= 5) {
    segments[4] = '***';
  }
  return '/' + segments.join('/');
}

export function deviceCallbackTimeout(timeoutMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    let settled = false;

    req.setTimeout(timeoutMs, () => {
      if (settled || res.headersSent) return;
      settled = true;
      logger.warn(
        `Device callback timeout sau ${timeoutMs}ms — method=${req.method} path=${redactCallbackTokenInPath(
          req.originalUrl || req.path,
        )} ip=${req.ip || req.socket?.remoteAddress || 'unknown'} — body có thể không khớp Content-Length đã khai.`,
      );
      // Destroy socket SAU khi response đã flush xong ('finish') — destroy ngay lập tức có
      // thể cắt ngang dữ liệu response đang ghi dở, khiến client không nhận đủ 408 body.
      res.once('finish', () => {
        try {
          req.socket?.destroy();
        } catch {
          // best-effort, không để lỗi dọn socket làm hỏng response đã gửi.
        }
      });
      res.status(408).json({
        success: false,
        message:
          'Request timeout — server did not receive the full request in time.',
        error: { code: 'DEVICE_CALLBACK_TIMEOUT', details: { timeoutMs } },
      });
    });

    res.on('finish', () => {
      settled = true;
    });

    next();
  };
}
