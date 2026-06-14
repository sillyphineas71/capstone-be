import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

/**
 * Catch TypeORM QueryFailedError và map PostgreSQL unique violation (23505)
 * thành 409 Conflict với mã lỗi DEPARTMENT_ALREADY_EXISTS.
 *
 * Các error code khác trả về 500 Internal Server Error.
 */
@Catch(QueryFailedError)
export class QueryFailedFilter implements ExceptionFilter {
  private readonly logger = new Logger(QueryFailedFilter.name);

  catch(exception: QueryFailedError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const driverError = (exception as any).driverError;
    const code: string | undefined = driverError?.code;
    const requestId = (request.headers['x-request-id'] as string) || 'unknown';

    // PostgreSQL unique violation
    if (code === '23505') {
      const constraint: string | undefined = driverError?.constraint;
      const field = constraint?.includes('department_code')
        ? 'departmentCode'
        : constraint?.includes('department_name')
          ? 'departmentName'
          : 'unknown';

      this.logger.warn(
        `Unique constraint violation: ${constraint} (requestId: ${requestId})`,
      );

      response.status(HttpStatus.CONFLICT).json({
        success: false,
        message:
          field === 'departmentCode'
            ? 'Mã phòng ban này đã được sử dụng'
            : 'Tên phòng ban này đã được sử dụng',
        error: {
          code: 'DEPARTMENT_ALREADY_EXISTS',
          details: { field },
        },
        requestId,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
      return;
    }

    // Other DB errors → 500
    this.logger.error(
      `Unhandled database error: ${exception.message} (code: ${code})`,
      exception.stack,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Internal server error',
      error: { code: 'INTERNAL_ERROR' },
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
