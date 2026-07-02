import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Scoped exception filter that reshapes HttpException body into
 * the standard API envelope: { success, message, error: { code, details }, timestamp, path }.
 *
 * Applied via @UseFilters(AdminAvatarReviewHttpExceptionFilter) on AdminAvatarReviewController.
 * Does not affect controllers outside this feature.
 */
@Catch(HttpException)
export class AdminAvatarReviewHttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const body = exception.getResponse() as
      | {
          code?: string;
          message?: string;
          error?: { code?: string; details?: Record<string, unknown> };
        }
      | string;

    let message: string;
    let code: string;
    let details: Record<string, unknown>;

    if (typeof body === 'string') {
      message = body;
      code = 'INTERNAL_ERROR';
      details = {};
    } else if (body?.error && typeof body.error === 'object') {
      // Already in envelope format
      message = body.message ?? body.error?.code ?? 'Unknown error';
      code = body.error?.code ?? 'INTERNAL_ERROR';
      details = body.error?.details ?? {};
    } else {
      message = body?.message ?? exception.message;
      code = body?.code ?? 'INTERNAL_ERROR';
      details = {};
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
