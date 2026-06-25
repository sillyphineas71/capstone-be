import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * AvatarHttpExceptionFilter — ACCT-AVATAR-SUBMIT-001 (EH-02).
 *
 * Reshape mọi HttpException của AvatarController về đúng envelope lỗi của spec (§11):
 *   { success:false, message, error:{code,details}, timestamp, path }
 *
 * Scoped chỉ cho AvatarController (qua @UseFilters), KHÔNG đăng ký global —
 * không ảnh hưởng QueryFailedFilter hay controller khác.
 */
@Catch(HttpException)
export class AvatarHttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();

    const raw = exception.getResponse();
    let code = 'INTERNAL_ERROR';
    let message = exception.message;
    let details: Record<string, unknown> = {};

    if (typeof raw === 'string') {
      message = raw;
    } else if (raw && typeof raw === 'object') {
      const body = raw as {
        code?: string;
        message?: string | string[];
        details?: Record<string, unknown>;
      };
      if (body.code) {
        code = body.code;
      }
      if (body.message) {
        message = Array.isArray(body.message)
          ? body.message.join(', ')
          : body.message;
      }
      if (body.details) {
        details = body.details;
      }
    }

    response.status(status).json({
      success: false,
      message,
      error: { code, details },
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
