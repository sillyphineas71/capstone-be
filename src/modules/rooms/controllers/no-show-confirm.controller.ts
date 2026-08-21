import { Controller, Get, HttpStatus, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { NoShowConfirmTokenService } from '../services/no-show-confirm-token.service.js';
import { NoShowService } from '../services/no-show.service.js';

function renderConfirmPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6fb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px}
  .card{background:#ffffff;border-radius:12px;box-shadow:0 4px 24px rgba(15,23,42,.08);padding:32px 28px;max-width:420px;text-align:center}
  h1{font-size:18px;color:#1e293b;margin:0 0 8px}
  p{font-size:14px;color:#475569;margin:0;line-height:1.5}
</style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

/**
 * NoShowConfirmController — Việc B, Hướng 2: xác nhận "Tôi vẫn đến" từ link
 * trong email, KHÔNG cần đăng nhập lại.
 *
 * Route CÔNG KHAI (không @UseGuards nào) — vì vậy CHỈ trả về 1 trang HTML tĩnh,
 * KHÔNG lộ thêm bất kỳ dữ liệu meeting/user/case nào khác. Hành động DUY NHẤT là
 * SNOOZE đúng case trong token (KHÔNG còn dismiss — Việc B tái đánh giá
 * 2026-08-21: "Tôi vẫn đến" gia hạn có hạn chót, KHÁC "Bỏ qua" của admin, xem
 * NoShowService.snooze()), tái dùng NGUYÊN authorization/idempotency đã có —
 * token chỉ thay thế cho việc đăng nhập lấy JWT, KHÔNG bypass business rule nào.
 *
 * 4 nhánh phản hồi (đều 200 + trang tĩnh, KHÔNG throw exception JSON/500):
 *  1. Token sai/hết hạn/sai người → "Liên kết không hợp lệ" (KHÔNG lộ lý do cụ thể).
 *  2. Case đã terminal thật (dismissed/released/resolved) → "Đã xử lý trước đó".
 *  3. Vừa snooze thành công → "Đã ghi nhận" kèm số phút gia hạn.
 *  4. Idempotent (đã snoozed từ trước, bấm lại) → "Đã ghi nhận" bản thân thiện,
 *     KHÔNG phải lỗi, KHÔNG gia hạn thêm.
 */
@ApiTags('Rooms - No-Show')
@Controller()
export class NoShowConfirmController {
  constructor(
    private readonly tokenService: NoShowConfirmTokenService,
    private readonly noShowService: NoShowService,
  ) {}

  @Get('no-show-confirm/:token')
  @ApiOperation({
    summary:
      '[CÔNG KHAI, không đăng nhập] Xác nhận "Tôi vẫn đến" từ link email — gia hạn (snooze) đúng 1 no-show case, trả trang HTML tĩnh',
  })
  async confirm(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    let payload: { caseId: string; userId: string };
    try {
      payload = await this.tokenService.verify(token);
    } catch {
      res
        .status(HttpStatus.OK)
        .type('html')
        .send(
          renderConfirmPage(
            'Liên kết không hợp lệ',
            'Liên kết này không đúng hoặc đã hết hạn. Vui lòng mở ứng dụng để xử lý trực tiếp.',
          ),
        );
      return;
    }

    try {
      const data = await this.noShowService.snooze(
        payload.caseId,
        payload.userId,
      );
      const alreadySnoozed = data.alreadySnoozed === true;
      const extensionMinutes =
        typeof data.extensionMinutes === 'number'
          ? data.extensionMinutes
          : null;
      const message = alreadySnoozed
        ? 'Bạn đã xác nhận trước đó — phòng vẫn đang được giữ, không cần bấm lại.'
        : extensionMinutes != null
          ? `Cảm ơn bạn đã xác nhận — phòng sẽ được giữ thêm ${extensionMinutes} phút.`
          : 'Cảm ơn bạn đã xác nhận — phòng sẽ được giữ thêm một khoảng thời gian nữa.';
      res
        .status(HttpStatus.OK)
        .type('html')
        .send(renderConfirmPage('Đã ghi nhận', message));
    } catch {
      // Case đã terminal (dismissed/released/resolved trước đó) hoặc userId trong
      // token không còn khớp organizer/host thật của meeting — no-op an toàn,
      // KHÔNG lộ mã lỗi/chi tiết ra route công khai này.
      res
        .status(HttpStatus.OK)
        .type('html')
        .send(
          renderConfirmPage(
            'Đã xử lý trước đó',
            'Yêu cầu này đã được xử lý hoặc không còn hiệu lực.',
          ),
        );
    }
  }
}
