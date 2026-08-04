/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { ConflictException } from '@nestjs/common';
import { LiveMeetingService } from '../services/live-meeting.service.js';
import { MeetingStatus } from '../../meetings/entities/meeting.entity.js';
import { MEETING_END_ERRORS } from '../constants/meeting-end-error.constant.js';

/**
 * F-A (MST-001) — cron lật meetings.status theo thời gian.
 *
 * File RIÊNG, KHÔNG nhét vào live-meeting.service.spec.ts: file đó đang có lỗi
 * cấu trúc sẵn (describe lồng trong it) + nhiều test phụ thuộc wall-clock đang
 * đỏ từ trước — thêm vào đó sẽ không phân biệt được lỗi mới/cũ.
 */
describe('LiveMeetingService — advance meeting statuses (F-A / MST-001)', () => {
  let service: LiveMeetingService;
  let dsMock: any;

  const build = () => {
    dsMock = {
      query: jest.fn(),
      getRepository: jest.fn(),
      transaction: jest.fn(),
      manager: { query: jest.fn() },
    };
    return new LiveMeetingService(
      dsMock,
      { emitToRoom: jest.fn() } as any,
      { addJob: jest.fn(), getQueue: jest.fn() } as any,
      { create: jest.fn(), markCompleted: jest.fn() } as any,
      { get: jest.fn((_k: string, d?: unknown) => d) } as any,
    );
  };

  beforeEach(() => {
    service = build();
  });

  describe('autoStartDueMeetings()', () => {
    it('UPDATE đúng: scheduled → in_progress, chỉ họp đã tới giờ, bỏ soft-delete', async () => {
      dsMock.query.mockResolvedValue([[], 2]);
      const r = await service.autoStartDueMeetings();

      expect(r.started).toBe(2);
      const [sql, params] = dsMock.query.mock.calls[0];
      expect(sql).toContain('UPDATE meetings');
      expect(sql).toContain('start_time <= now()');
      expect(sql).toContain('deleted_at IS NULL');
      expect(params).toEqual([
        MeetingStatus.IN_PROGRESS,
        MeetingStatus.SCHEDULED,
      ]);
    });

    it('actual_start_time = start_time theo LỊCH (không phải now()), COALESCE giữ mốc đã có', async () => {
      dsMock.query.mockResolvedValue([[], 0]);
      await service.autoStartDueMeetings();

      const [sql] = dsMock.query.mock.calls[0];
      expect(sql).toContain(
        'actual_start_time = COALESCE(actual_start_time, start_time)',
      );
      // Chặn hồi quy: KHÔNG được gán now() — cron chạy mỗi phút sẽ lệch, và
      // server tắt/bật lại thì lệch rất xa giờ lịch.
      expect(sql).not.toMatch(/actual_start_time\s*=\s*now\(\)/);
    });

    it('CHỈ đụng status=scheduled → cancelled/draft/pending_approval/completed nguyên vẹn', async () => {
      dsMock.query.mockResolvedValue([[], 0]);
      await service.autoStartDueMeetings();

      const [sql, params] = dsMock.query.mock.calls[0];
      expect(sql).toContain('WHERE status = $2');
      expect(params[1]).toBe(MeetingStatus.SCHEDULED);
      for (const untouched of [
        MeetingStatus.CANCELLED,
        MeetingStatus.DRAFT,
        MeetingStatus.PENDING_APPROVAL,
        MeetingStatus.COMPLETED,
      ]) {
        expect(sql).not.toContain(untouched);
      }
    });

    it('không có họp nào tới giờ → started=0, KHÔNG lỗi (idempotent)', async () => {
      dsMock.query.mockResolvedValue([[], 0]);
      await expect(service.autoStartDueMeetings()).resolves.toEqual({
        started: 0,
      });
    });

    it('driver trả dạng lạ (không phải [rows, rowCount]) → started=0, KHÔNG crash', async () => {
      dsMock.query.mockResolvedValue(undefined);
      await expect(service.autoStartDueMeetings()).resolves.toEqual({
        started: 0,
      });
    });
  });

  describe('advanceMeetingStatuses()', () => {
    it('chạy start TRƯỚC complete (họp scheduled quá giờ phải qua in_progress mới endMeeting được)', async () => {
      const order: string[] = [];
      jest
        .spyOn(service, 'autoStartDueMeetings')
        .mockImplementation(async () => {
          order.push('start');
          return { started: 1 };
        });
      jest
        .spyOn(service, 'autoCompleteOverdueMeetings')
        .mockImplementation(async () => {
          order.push('complete');
          return { scanned: 1, completed: 1, skipped: 0, failed: 0 };
        });

      const r = await service.advanceMeetingStatuses();

      expect(order).toEqual(['start', 'complete']);
      expect(r).toEqual({
        started: 1,
        scanned: 1,
        completed: 1,
        skipped: 0,
        failed: 0,
      });
    });
  });

  describe('autoCompleteOverdueMeetings()', () => {
    it('quét scheduled + in_progress quá end_time, gọi endMeeting với organizer làm actor', async () => {
      dsMock.query.mockResolvedValue([
        { id: 'm1', organizer_id: 'org-1' },
        { id: 'm2', organizer_id: 'org-2' },
      ]);
      const endSpy = jest
        .spyOn(service, 'endMeeting')
        .mockResolvedValue({} as any);

      const r = await service.autoCompleteOverdueMeetings();

      const [sql] = dsMock.query.mock.calls[0];
      expect(sql).toContain("status IN ('scheduled', 'in_progress')");
      expect(sql).toContain('end_time < now()');
      expect(endSpy).toHaveBeenCalledTimes(2);
      expect(endSpy.mock.calls[0][1]).toEqual({ userId: 'org-1' });
      expect(r).toEqual({
        scanned: 2,
        completed: 2,
        skipped: 0,
        failed: 0,
      });
    });

    it('MEETING_NOT_STARTED → tính skipped, KHÔNG phải failed', async () => {
      dsMock.query.mockResolvedValue([{ id: 'm1', organizer_id: 'org-1' }]);
      jest.spyOn(service, 'endMeeting').mockRejectedValue(
        new ConflictException({
          success: false,
          message: 'x',
          error: { code: MEETING_END_ERRORS.MEETING_NOT_STARTED, details: {} },
        }),
      );

      const r = await service.autoCompleteOverdueMeetings();
      expect(r).toEqual({
        scanned: 1,
        completed: 0,
        skipped: 1,
        failed: 0,
      });
    });

    it('1 meeting lỗi → đếm failed, các meeting khác VẪN được xử lý tiếp', async () => {
      dsMock.query.mockResolvedValue([
        { id: 'bad', organizer_id: 'o1' },
        { id: 'good', organizer_id: 'o2' },
      ]);
      jest
        .spyOn(service, 'endMeeting')
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce({} as any);

      const r = await service.autoCompleteOverdueMeetings();
      expect(r).toEqual({
        scanned: 2,
        completed: 1,
        skipped: 0,
        failed: 1,
      });
    });
  });
});
