import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard.js';

/**
 * JwtQueryOrHeaderAuthGuard — fallback dự phòng CHỈ cho route mà trình duyệt tự
 * request như static resource (vd `<img src="...snapshot">`) và KHÔNG thể gắn header
 * Authorization qua interceptor FE. Ưu tiên header Authorization như JwtAuthGuard gốc;
 * KHÔNG có mới rơi xuống query param `?token=`.
 *
 * KHÔNG override canActivate — toàn bộ verify/blacklist/invalid_after logic vẫn ở
 * JwtAuthGuard#canActivate (kế thừa nguyên vẹn), guard này CHỈ đổi NGUỒN lấy token thô.
 * Token rớt xuống nhánh query vẫn đi qua đúng cùng 1 luồng verify — KHÔNG bớt bước.
 *
 * TUYỆT ĐỐI KHÔNG gắn guard này cho route khác ngoài snapshot: token qua query string
 * dễ lộ hơn header (browser history, Referer header, access log của proxy/CDN).
 */
@Injectable()
export class JwtQueryOrHeaderAuthGuard extends JwtAuthGuard {
  protected extractTokenFromHeader(request: Request): string | undefined {
    const fromHeader = super.extractTokenFromHeader(request);
    if (fromHeader) return fromHeader;

    const fromQuery = request.query?.['token'];
    return typeof fromQuery === 'string' && fromQuery ? fromQuery : undefined;
  }
}
