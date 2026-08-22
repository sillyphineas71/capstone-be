import * as ExcelJS from 'exceljs';
import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { ParticipantImportService } from './participant-import.service.js';
import {
  MeetingEntity,
  MeetingStatus,
  MeetingVisibilityLevel,
} from '../entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../entities/meeting-external-participant.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import {
  UserEntity,
  AccountStatus,
} from '../../accounts/entities/user.entity.js';
import { UserRoleEntity } from '../../accounts/entities/user-role.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import {
  IMPORT_PARTICIPANTS_HEADERS,
  IMPORT_PARTICIPANTS_COLUMNS,
  XLSX_MIME,
  ImportRowStatus,
  ImportRowReason,
} from '../constants/import-participants.constants.js';

type AnyRow = Record<string, string | number>;

async function buildXlsx(
  rows: AnyRow[],
  columns: ReadonlyArray<{
    key: string;
    header: string;
  }> = IMPORT_PARTICIPANTS_COLUMNS,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Participants');
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: 20,
  }));
  rows.forEach((r) => sheet.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * Layout template legacy 7 cột (trước 2026-08-23) — BE vẫn phải đọc được vì người dùng
 * có thể còn giữ file cũ.
 */
const LEGACY_COLUMNS = [
  { key: 'stt', header: 'STT' },
  { key: 'type', header: 'Loại' },
  { key: 'email', header: 'Email' },
  { key: 'employee_code', header: 'Mã nhân viên' },
  { key: 'full_name', header: 'Họ và tên' },
  { key: 'organization_name', header: 'Tổ chức' },
  { key: 'phone_number', header: 'Số điện thoại' },
] as const;

function fileOf(buffer: Buffer) {
  return {
    buffer,
    mimetype: XLSX_MIME,
    size: buffer.length,
    originalname: 'participants.xlsx',
  };
}

describe('ParticipantImportService', () => {
  let service: ParticipantImportService;
  let meetingsService: any;
  let notificationsService: any;
  let dataSource: any;

  let meeting: Partial<MeetingEntity>;
  let dbUsers: Array<Partial<UserEntity>>;
  let existingParticipantUserIds: string[];
  /** userId đang giữ role BUSINESS_ADMIN/SYSTEM_ADMIN -> không được mời họp. */
  let ineligibleUserIds: string[];

  beforeEach(() => {
    meeting = {
      id: 'meeting-1',
      status: MeetingStatus.SCHEDULED,
      visibilityLevel: MeetingVisibilityLevel.PUBLIC,
      organizerId: 'organizer-1',
      hostId: 'host-1',
      title: 'Sprint Planning',
      roomId: null,
      startTime: new Date('2026-08-01T02:00:00Z'),
      endTime: new Date('2026-08-01T03:00:00Z'),
      deletedAt: null,
    };
    dbUsers = [
      {
        id: 'u-an',
        email: 'an@company.com',
        employeeCode: 'EMP001',
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
      },
      {
        id: 'u-binh',
        email: 'binh@company.com',
        employeeCode: 'EMP002',
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
      },
    ];
    existingParticipantUserIds = [];
    ineligibleUserIds = [];

    meetingsService = {
      checkUserPermission: jest.fn().mockResolvedValue(false),
      checkParticipantConflicts: jest.fn().mockResolvedValue({
        conflicts: [],
        hasConflict: false,
        conflictCount: 0,
      }),
      getAttendeeCount: jest.fn().mockResolvedValue(0),
      persistInternalParticipantCore: jest
        .fn()
        .mockResolvedValue('pid-internal'),
      persistExternalParticipantCore: jest
        .fn()
        .mockResolvedValue('pid-external'),
    };
    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({}),
      enqueueEmailNotification: jest.fn().mockResolvedValue({}),
    };

    const meetingRepo = { findOne: jest.fn().mockResolvedValue(meeting) };
    const userRepo = {
      find: jest.fn((opts: any) => {
        const clauses = Array.isArray(opts.where) ? opts.where : [opts.where];
        const emails: string[] = [];
        const codes: string[] = [];
        for (const c of clauses) {
          if (c.email) emails.push(...c.email.value);
          if (c.employeeCode) codes.push(...c.employeeCode.value);
        }
        return Promise.resolve(
          dbUsers.filter(
            (u) =>
              (u.email && emails.includes(u.email)) ||
              (u.employeeCode && codes.includes(u.employeeCode)),
          ),
        );
      }),
    };
    const participantRepo = {
      find: jest.fn(() =>
        Promise.resolve(
          existingParticipantUserIds.map((userId) => ({ userId })),
        ),
      ),
    };
    const externalRepo = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };
    // Role check (getIneligibleMeetingUserIds) dùng query builder -> mock riêng.
    const userRoleRepo = {
      createQueryBuilder: jest.fn(() => ({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawMany: jest.fn(() =>
          Promise.resolve(ineligibleUserIds.map((userId) => ({ userId }))),
        ),
      })),
    };
    const roomRepo = { findOne: jest.fn().mockResolvedValue(null) };
    const configRepo = { findOne: jest.fn().mockResolvedValue(null) };

    dataSource = {
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingEntity) return meetingRepo;
        if (entity === UserEntity) return userRepo;
        if (entity === MeetingParticipantEntity) return participantRepo;
        if (entity === MeetingExternalParticipantEntity) return externalRepo;
        if (entity === UserRoleEntity) return userRoleRepo;
        if (entity === RoomEntity) return roomRepo;
        if (entity === SystemConfigEntity) return configRepo;
        return { find: jest.fn().mockResolvedValue([]) };
      }),
      transaction: jest.fn((cb: any) => cb({})),
      manager: { save: jest.fn().mockResolvedValue({}) },
    };

    service = new ParticipantImportService(
      dataSource,
      meetingsService,
      notificationsService,
    );
  });

  const authUser = { userId: 'organizer-1' };
  const ctx = {};

  it('rejects non-xlsx file', async () => {
    await expect(
      service.importParticipants(
        'meeting-1',
        {
          buffer: Buffer.from('x'),
          mimetype: 'text/plain',
          originalname: 'a.txt',
        },
        {},
        authUser,
        ctx,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects wrong header', async () => {
    const buf = await buildXlsx(
      [{ wrong: 'x' }],
      [{ key: 'wrong', header: 'wrong' }],
    );
    await expect(
      service.importParticipants('meeting-1', fileOf(buf), {}, authUser, ctx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file with an unknown extra column', async () => {
    const buf = await buildXlsx(
      [{ email: 'an@company.com', extra: 'x' }],
      [...IMPORT_PARTICIPANTS_COLUMNS, { key: 'extra', header: 'Extra' }],
    );
    await expect(
      service.importParticipants('meeting-1', fileOf(buf), {}, authUser, ctx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still reads the legacy 7-column template (STT / Loại) by header name', async () => {
    const buf = await buildXlsx(
      [
        { stt: 1, type: 'Nội bộ', email: 'an@company.com' },
        {
          stt: 2,
          type: 'Khách ngoài',
          email: 'guest@ext.com',
          full_name: 'Guest X',
        },
      ],
      LEGACY_COLUMNS,
    );

    const report = await service.importParticipants(
      'meeting-1',
      fileOf(buf),
      {},
      authUser,
      ctx,
    );

    expect(report.successCount).toBe(2);
    expect(report.failedCount).toBe(0);
  });

  it('skips rows where only STT is filled and the rest are empty', async () => {
    const buf = await buildXlsx(
      [{ stt: 1, type: 'internal', email: 'an@company.com' }, { stt: 2 }],
      LEGACY_COLUMNS,
    );

    const report = await service.importParticipants(
      'meeting-1',
      fileOf(buf),
      {},
      authUser,
      ctx,
    );

    expect(report.totalRows).toBe(1);
    expect(report.successCount).toBe(1);
  });

  it('auto-detects internal vs external, commits and dispatches notifications', async () => {
    const buf = await buildXlsx([
      { email: 'an@company.com' },
      { email: '', employee_code: 'EMP002' },
      {
        email: 'guest@ext.com',
        full_name: 'Guest X',
        organization_name: 'ABC',
      },
    ]);

    const report = await service.importParticipants(
      'meeting-1',
      fileOf(buf),
      {},
      authUser,
      ctx,
    );

    expect(report.successCount).toBe(3);
    expect(report.failedCount).toBe(0);
    expect(
      meetingsService.persistInternalParticipantCore,
    ).toHaveBeenCalledTimes(2);
    expect(
      meetingsService.persistExternalParticipantCore,
    ).toHaveBeenCalledTimes(1);
    // Internal: one batched in-app notification, NO internal email
    expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    // External: one email per guest
    expect(notificationsService.enqueueEmailNotification).toHaveBeenCalledTimes(
      1,
    );
  });

  it('marks unknown user and duplicate-in-file rows as errors (with force)', async () => {
    const buf = await buildXlsx(
      [
        { type: 'internal', email: 'ghost@company.com' },
        { type: 'internal', email: 'an@company.com' },
        { type: 'internal', email: 'an@company.com' },
        { type: 'wrong', email: 'x@company.com' },
      ],
      LEGACY_COLUMNS,
    );

    const report = await service.importParticipants(
      'meeting-1',
      fileOf(buf),
      { forceAddWithWarnings: true },
      authUser,
      ctx,
    );

    const reasons = report.results.map((r) => r.reason);
    expect(reasons).toContain(ImportRowReason.USER_NOT_FOUND);
    expect(reasons).toContain(ImportRowReason.DUPLICATE_IN_FILE);
    expect(reasons).toContain(ImportRowReason.INVALID_ROW_TYPE);
    expect(report.successCount).toBe(1); // only the first an@company.com
  });

  it('an unresolved email with no full name is reported as an invalid guest row', async () => {
    const buf = await buildXlsx([{ email: 'ghost@company.com' }]);

    await expect(
      service.importParticipants('meeting-1', fileOf(buf), {}, authUser, ctx),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    const report = await service.importParticipants(
      'meeting-1',
      fileOf(buf),
      { forceAddWithWarnings: true },
      authUser,
      ctx,
    );
    expect(report.results[0].reason).toBe(ImportRowReason.INVALID_EXTERNAL_ROW);
    expect(report.successCount).toBe(0);
  });

  it('two-step: error row without force -> 422 preview and no DB write', async () => {
    const buf = await buildXlsx([
      { email: 'an@company.com' },
      { email: 'ghost@company.com' }, // thiếu Họ và tên -> lỗi
    ]);

    await expect(
      service.importParticipants('meeting-1', fileOf(buf), {}, authUser, ctx),
    ).rejects.toMatchObject({
      response: {
        error: {
          details: { totalRows: 2, successCount: 1, failedCount: 1 },
        },
      },
    });
    expect(
      meetingsService.persistInternalParticipantCore,
    ).not.toHaveBeenCalled();
  });

  it('rejects a row resolving to a Business Admin / System Admin account', async () => {
    ineligibleUserIds = ['u-an'];
    const buf = await buildXlsx([{ email: 'an@company.com' }]);

    const report = await service.importParticipants(
      'meeting-1',
      fileOf(buf),
      { forceAddWithWarnings: true },
      authUser,
      ctx,
    );
    expect(report.results[0].reason).toBe(ImportRowReason.ROLE_NOT_ALLOWED);
    expect(report.successCount).toBe(0);
  });

  it('two-step: warning without force → 422 and no DB write', async () => {
    meetingsService.checkParticipantConflicts.mockResolvedValue({
      conflicts: [{ userId: 'u-an', busyFrom: 'x', busyTo: 'y' }],
      hasConflict: true,
      conflictCount: 1,
    });
    const buf = await buildXlsx([{ email: 'an@company.com' }]);

    await expect(
      service.importParticipants(
        'meeting-1',
        fileOf(buf),
        { forceAddWithWarnings: false },
        authUser,
        ctx,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(
      meetingsService.persistInternalParticipantCore,
    ).not.toHaveBeenCalled();
  });

  it('two-step: warning with force=true → commits', async () => {
    meetingsService.checkParticipantConflicts.mockResolvedValue({
      conflicts: [{ userId: 'u-an', busyFrom: 'x', busyTo: 'y' }],
      hasConflict: true,
      conflictCount: 1,
    });
    const buf = await buildXlsx([{ email: 'an@company.com' }]);

    const report = await service.importParticipants(
      'meeting-1',
      fileOf(buf),
      { forceAddWithWarnings: true },
      authUser,
      ctx,
    );
    expect(report.successCount).toBe(1);
    expect(report.warningCount).toBe(1);
    expect(
      meetingsService.persistInternalParticipantCore,
    ).toHaveBeenCalledTimes(1);
  });

  it('generates a template with the correct headers', async () => {
    const buffer = await service.generateTemplate();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0];
    const headers = IMPORT_PARTICIPANTS_HEADERS.map((_, i) =>
      String(sheet.getRow(1).getCell(i + 1).value ?? '').toLowerCase(),
    );
    expect(headers).toEqual(
      IMPORT_PARTICIPANTS_HEADERS.map((h) => h.toLowerCase()),
    );
  });

  it('marks status success/failed correctly in results', async () => {
    const buf = await buildXlsx([{ email: 'an@company.com' }]);
    const report = await service.importParticipants(
      'meeting-1',
      fileOf(buf),
      {},
      authUser,
      ctx,
    );
    expect(report.results[0].status).toBe(ImportRowStatus.SUCCESS);
  });
});
