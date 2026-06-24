/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, ArgumentsHost } from '@nestjs/common';
import { AvatarHttpExceptionFilter } from './avatar-http-exception.filter.js';

/**
 * ACCT-AVATAR-SUBMIT-001 — Unit test cho AvatarHttpExceptionFilter (EH-02).
 */
describe('AvatarHttpExceptionFilter', () => {
  let filter: AvatarHttpExceptionFilter;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new AvatarHttpExceptionFilter();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: statusMock }),
        getRequest: () => ({ url: '/api/v1/me/avatar-submission' }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('reshape HttpException {code,message} về envelope chuẩn', () => {
    const exception = new BadRequestException({
      code: 'AVATAR_CONSENT_REQUIRED',
      message: 'consent required',
    });

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(400);
    const payload = jsonMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      success: false,
      message: 'consent required',
      error: { code: 'AVATAR_CONSENT_REQUIRED', details: {} },
      path: '/api/v1/me/avatar-submission',
    });
    expect(payload.timestamp).toBeDefined();
  });

  it('fallback code INTERNAL_ERROR khi body không có code', () => {
    const exception = new BadRequestException('plain message');
    filter.catch(exception, host);
    const payload = jsonMock.mock.calls[0][0];
    expect(payload.error.code).toBe('INTERNAL_ERROR');
    expect(payload.message).toBe('plain message');
  });
});
