/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { NoShowConfirmController } from './no-show-confirm.controller.js';
import { NoShowConfirmTokenService } from '../services/no-show-confirm-token.service.js';
import { NoShowService } from '../services/no-show.service.js';

describe('NoShowConfirmController (Việc B, Hướng 2 — route công khai)', () => {
  let controller: NoShowConfirmController;
  let tokenServiceMock: any;
  let noShowServiceMock: any;
  let resMock: any;

  beforeEach(async () => {
    tokenServiceMock = { verify: jest.fn() };
    noShowServiceMock = { snooze: jest.fn() };
    resMock = {
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NoShowConfirmController],
      providers: [
        { provide: NoShowConfirmTokenService, useValue: tokenServiceMock },
        { provide: NoShowService, useValue: noShowServiceMock },
      ],
    }).compile();
    controller = module.get(NoShowConfirmController);
  });

  it('token hợp lệ + case còn non-terminal → snooze thành công, trang "Đã ghi nhận" kèm số phút gia hạn', async () => {
    tokenServiceMock.verify.mockResolvedValue({
      caseId: 'case-1',
      userId: 'user-1',
    });
    noShowServiceMock.snooze.mockResolvedValue({
      detectionStatus: 'snoozed',
      alreadySnoozed: false,
      extensionMinutes: 10,
    });

    await controller.confirm('good-token', resMock);

    expect(noShowServiceMock.snooze).toHaveBeenCalledWith('case-1', 'user-1');
    expect(resMock.status).toHaveBeenCalledWith(200);
    expect(resMock.type).toHaveBeenCalledWith('html');
    const html = String(resMock.send.mock.calls[0][0]);
    expect(html).toContain('Đã ghi nhận');
    expect(html).toContain('10 phút');
  });

  it('idempotent — đã snoozed từ trước, bấm lại → trang "Đã ghi nhận" bản thân thiện (KHÔNG lỗi, KHÔNG số phút gia hạn mới)', async () => {
    tokenServiceMock.verify.mockResolvedValue({
      caseId: 'case-1',
      userId: 'user-1',
    });
    noShowServiceMock.snooze.mockResolvedValue({
      detectionStatus: 'snoozed',
      alreadySnoozed: true,
      snoozeUntil: '2026-08-21T11:00:00Z',
    });

    await controller.confirm('good-token', resMock);

    expect(resMock.status).toHaveBeenCalledWith(200);
    const html = String(resMock.send.mock.calls[0][0]);
    expect(html).toContain('Đã ghi nhận');
    expect(html).toContain('đã xác nhận trước đó');
  });

  it('token hết hạn/sai chữ ký (verify() reject) → 200 + trang "Liên kết không hợp lệ", KHÔNG throw 500, KHÔNG gọi snooze()', async () => {
    tokenServiceMock.verify.mockRejectedValue(new Error('jwt expired'));

    await controller.confirm('bad-token', resMock);

    expect(noShowServiceMock.snooze).not.toHaveBeenCalled();
    expect(resMock.status).toHaveBeenCalledWith(200);
    expect(String(resMock.send.mock.calls[0][0])).toContain(
      'Liên kết không hợp lệ',
    );
  });

  it('token hợp lệ nhưng case đã terminal thật (snooze() ném BadRequestException) → 200 + trang "Đã xử lý trước đó", KHÔNG lộ chi tiết lỗi', async () => {
    tokenServiceMock.verify.mockResolvedValue({
      caseId: 'case-1',
      userId: 'user-1',
    });
    noShowServiceMock.snooze.mockRejectedValue(
      new BadRequestException({
        code: 'INVALID_NO_SHOW_TRANSITION',
        message: 'No-show case is already finalized.',
      }),
    );

    await controller.confirm('good-token', resMock);

    expect(resMock.status).toHaveBeenCalledWith(200);
    const html = String(resMock.send.mock.calls[0][0]);
    expect(html).toContain('Đã xử lý trước đó');
    expect(html).not.toContain('INVALID_NO_SHOW_TRANSITION');
    expect(html).not.toContain('finalized');
  });

  // [2.2] Test bắt buộc: token đúng chữ ký/đúng userId nhưng KHÔNG còn là
  // organizer/host thật của case (giả lập payload giả/đã đổi host) — verify() tin
  // token, nhưng NoShowService.snooze() TỰ re-check với DB thật (assertAuthorized)
  // và ném ForbiddenException → phải bị từ chối, KHÔNG snooze được.
  it('token đúng userId nhưng KHÔNG phải organizer/host thật của case → snooze() ném ForbiddenException → 200 + trang chung, KHÔNG snooze', async () => {
    tokenServiceMock.verify.mockResolvedValue({
      caseId: 'case-1',
      userId: 'not-the-real-organizer-or-host',
    });
    noShowServiceMock.snooze.mockRejectedValue(
      new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền thực hiện hành động này.',
        error: { code: 'FORBIDDEN', details: {} },
      }),
    );

    await controller.confirm('good-token-wrong-owner', resMock);

    expect(noShowServiceMock.snooze).toHaveBeenCalledWith(
      'case-1',
      'not-the-real-organizer-or-host',
    );
    const html = String(resMock.send.mock.calls[0][0]);
    expect(resMock.status).toHaveBeenCalledWith(200);
    expect(html).toContain('Đã xử lý trước đó');
    expect(html).not.toContain('FORBIDDEN');
  });

  it('response KHÔNG lộ caseId/userId ra HTML (route công khai, không đăng nhập)', async () => {
    tokenServiceMock.verify.mockResolvedValue({
      caseId: 'case-super-secret-id',
      userId: 'user-super-secret-id',
    });
    noShowServiceMock.snooze.mockResolvedValue({
      detectionStatus: 'snoozed',
      alreadySnoozed: false,
      extensionMinutes: 10,
    });

    await controller.confirm('good-token', resMock);

    const html = String(resMock.send.mock.calls[0][0]);
    expect(html).not.toContain('case-super-secret-id');
    expect(html).not.toContain('user-super-secret-id');
  });
});
