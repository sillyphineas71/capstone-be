import { NotFoundException } from '@nestjs/common';
import { AttendanceService } from '../services/attendance.service.js';

/**
 * UC-82 — AttendanceService.getAttendanceRecordDetail: load record + tên người/họp
 * + editHistory (batch audit) + read-only. File test RIÊNG.
 */
describe('AttendanceService.getAttendanceRecordDetail (UC-82)', () => {
  const meetingId = 'meet-1';
  const recordId = 'rec-1';
  const userId = 'user-1';

  function makeRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: recordId,
      meetingId,
      userId,
      participantId: null,
      checkInMethod: 'manual',
      attendanceSource: 'manual',
      checkInTime: null,
      checkOutTime: null,
      isLate: false,
      lateMinutes: null,
      leftEarly: false,
      attendanceStatus: 'present',
      verifiedBy: null,
      verifiedAt: null,
      note: null,
      createdAt: new Date('2026-07-14T01:00:00Z'),
      updatedAt: new Date('2026-07-14T02:00:00Z'),
      user: { fullName: 'Nguyen Van A' },
      meeting: { title: 'Hop tuan' },
      ...overrides,
    };
  }

  function setup(opts: { record?: unknown; auditRows?: unknown[] }) {
    const findOne = jest
      .fn()
      .mockResolvedValue(
        opts.record === undefined ? makeRecord() : opts.record,
      );
    const auditFind = jest.fn().mockResolvedValue(opts.auditRows ?? []);
    const save = jest.fn();

    const attendanceRecordRepo = {
      findOne,
      save,
      manager: { getRepository: jest.fn(() => ({ find: auditFind })) },
    } as unknown as import('typeorm').Repository<never>;

    const service = new AttendanceService(
      {} as never,
      {} as never,
      {} as never,
      attendanceRecordRepo,
    );
    return { service, findOne, auditFind, save };
  }

  it('[D1] record ton tai → detail + ten nguoi/hop + editHistory dung thu tu', async () => {
    const { service } = setup({
      auditRows: [
        {
          createdAt: new Date('2026-07-14T01:00:00Z'),
          userId: 'actor-1',
          actionType: 'create_manual_attendance',
          oldValueJson: null,
          newValueJson: { attendanceStatus: 'present' },
          metadataJson: null,
        },
        {
          createdAt: new Date('2026-07-14T03:00:00Z'),
          userId: 'actor-2',
          actionType: 'invalidate_attendance',
          oldValueJson: null,
          newValueJson: null,
          metadataJson: { reason: 'sai lich' },
        },
      ],
    });
    const res = await service.getAttendanceRecordDetail(meetingId, recordId);
    expect(res.id).toBe(recordId);
    expect(res.userFullName).toBe('Nguyen Van A');
    expect(res.meetingTitle).toBe('Hop tuan');
    expect(res.editHistory).toHaveLength(2);
    // thu tu asc + changes linh hoat
    expect(res.editHistory[0].actionType).toBe('create_manual_attendance');
    expect(res.editHistory[0].changes).toEqual({
      old: null,
      new: { attendanceStatus: 'present' },
    });
    expect(res.editHistory[1].actionType).toBe('invalidate_attendance');
    expect(res.editHistory[1].changes).toEqual({ reason: 'sai lich' }); // metadata-only
    expect(res.editHistory[0].at < res.editHistory[1].at).toBe(true);
  });

  it('[D2] record khong ton tai / khac meeting → 404 ATTENDANCE_RECORD_NOT_FOUND', async () => {
    const { service } = setup({ record: null });
    await expect(
      service.getAttendanceRecordDetail(meetingId, recordId),
    ).rejects.toThrow(NotFoundException);
  });

  it('[D3] editHistory BATCH 1 query — auditFind goi 1 lan voi In([4]) + order ASC', async () => {
    const { service, auditFind } = setup({});
    await service.getAttendanceRecordDetail(meetingId, recordId);
    expect(auditFind).toHaveBeenCalledTimes(1);
    const arg = (auditFind.mock.calls[0] as unknown[])[0] as {
      where: { entityId: string; actionType: unknown };
      order: { createdAt: string };
    };
    expect(arg.where.entityId).toBe(recordId);
    expect(arg.order.createdAt).toBe('ASC');
    // In([...]) — 4 actionType
    const inVal = arg.where.actionType as { _value?: string[] };
    expect(inVal._value).toEqual([
      'create_manual_attendance',
      'update_attendance_status',
      'update_attendance_record',
      'invalidate_attendance',
    ]);
  });

  it('[D4] editHistory rong → []', async () => {
    const { service } = setup({ auditRows: [] });
    const res = await service.getAttendanceRecordDetail(meetingId, recordId);
    expect(res.editHistory).toEqual([]);
  });

  it('[D5] READ-only — khong goi save', async () => {
    const { service, save } = setup({});
    await service.getAttendanceRecordDetail(meetingId, recordId);
    expect(save).not.toHaveBeenCalled();
  });
});
