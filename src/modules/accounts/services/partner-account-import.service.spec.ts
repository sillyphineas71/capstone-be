import * as ExcelJS from 'exceljs';
import { BadRequestException, ConflictException } from '@nestjs/common';

import { PartnerAccountImportService } from './partner-account-import.service.js';
import { DepartmentEntity } from '../entities/department.entity.js';
import { RoleEntity } from '../entities/role.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { PARTNER_DEPARTMENT_ID } from '../../../common/utils/partner-account.util.js';
import {
  IMPORT_PARTNER_HEADERS,
  XLSX_MIME,
  ImportPartnerAccountRowReason,
} from '../constants/import-partner-accounts.constants.js';

type AnyRow = Record<string, string>;

async function buildXlsx(
  rows: AnyRow[],
  headers: readonly string[] = IMPORT_PARTNER_HEADERS,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Partners');
  sheet.columns = headers.map((h) => ({ header: h, key: h, width: 20 }));
  rows.forEach((r) => sheet.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function fileOf(buffer: Buffer) {
  return {
    buffer,
    mimetype: XLSX_MIME,
    size: buffer.length,
    originalname: 'partners.xlsx',
  };
}

// 1x1 8-bit PNG image buffer (valid magic bytes: 0x89, 'P', 'N', 'G')
const VALID_PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

describe('PartnerAccountImportService', () => {
  let service: PartnerAccountImportService;
  let usersService: { persistAccount: jest.Mock };
  let notificationsService: { enqueueEmailNotification: jest.Mock };
  let cloudinaryService: { uploadImage: jest.Mock; deleteImage: jest.Mock };
  let vehicleRegistrationService: { register: jest.Mock };
  let dataSource: any;

  let dbDepartments: Array<Partial<DepartmentEntity>>;
  let dbRoles: Array<Partial<RoleEntity>>;

  beforeEach(() => {
    dbDepartments = [
      { id: PARTNER_DEPARTMENT_ID, departmentCode: 'PARTNER', isActive: true },
    ];
    dbRoles = [{ id: 'role-emp', roleCode: 'EMPLOYEE', isActive: true }];

    usersService = {
      persistAccount: jest.fn().mockImplementation((_em, data) =>
        Promise.resolve({
          user: { id: `user-${data.email}` },
          tempPassword: 'password123',
        }),
      ),
    };
    notificationsService = {
      enqueueEmailNotification: jest.fn().mockResolvedValue({}),
    };
    cloudinaryService = {
      uploadImage: jest
        .fn()
        .mockResolvedValue({ publicId: 'p1', secureUrl: 'https://x/p1.jpg' }),
      deleteImage: jest.fn().mockResolvedValue(undefined),
    };
    vehicleRegistrationService = {
      register: jest.fn().mockResolvedValue({ id: 'vr-1', status: 'active' }),
    };

    const deptRepo = {
      findOne: jest.fn(({ where }: any) => {
        return Promise.resolve(
          dbDepartments.find(
            (d) => d.id === where.id && d.isActive === where.isActive,
          ),
        );
      }),
    };
    const roleRepo = {
      findOne: jest.fn(({ where }: any) => {
        return Promise.resolve(
          dbRoles.find(
            (r) =>
              r.roleCode === where.roleCode && r.isActive === where.isActive,
          ),
        );
      }),
    };

    dataSource = {
      getRepository: jest.fn((entity: any) => {
        if (entity === DepartmentEntity) return deptRepo;
        if (entity === RoleEntity) return roleRepo;
        return { findOne: jest.fn().mockResolvedValue(null) };
      }),
      query: jest.fn((sql: string, params: any[]) => {
        if (sql.includes('FROM users WHERE LOWER(email)')) {
          // Check existing email
          const existing = params[0]?.includes('exists@partner.com')
            ? [{ email: 'exists@partner.com' }]
            : [];
          return Promise.resolve(existing);
        }
        return Promise.resolve([]);
      }),
      transaction: jest.fn((cb: any) =>
        cb({
          getRepository: jest.fn(() => ({
            insert: jest.fn().mockResolvedValue({}),
          })),
        }),
      ),
      manager: { save: jest.fn().mockResolvedValue({}) },
    };

    service = new PartnerAccountImportService(
      dataSource,
      usersService as any,
      notificationsService as any,
      cloudinaryService as any,
      vehicleRegistrationService as any,
    );
  });

  const actor = { id: 'admin-1' };
  const ctx = {};

  it('generates template with 2 sheets and correct headers', async () => {
    const buffer = await service.generateTemplate();
    expect(buffer).toBeInstanceOf(Buffer);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.length).toBe(2);
    expect(wb.worksheets[0].name).toBe('Partners');
    expect(wb.worksheets[1].name).toBe('Huong dan');
  });

  it('rejects file larger than limit', async () => {
    const buf = Buffer.alloc(3 * 1024 * 1024);
    await expect(
      service.importPartnerAccounts(
        { buffer: buf, size: buf.length },
        [],
        undefined,
        {},
        actor,
        ctx,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects invalid defaultExpiresInDays', async () => {
    const xlsxBuf = await buildXlsx([
      { full_name: 'Test', email: 'test@partner.com' },
    ]);
    await expect(
      service.importPartnerAccounts(
        fileOf(xlsxBuf),
        [],
        undefined,
        { defaultExpiresInDays: 0 },
        actor,
        ctx,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('preview mode validates static rules without writing DB or Cloudinary', async () => {
    const futureDate = new Date(Date.now() + 86400 * 1000 * 5).toISOString();

    const rows = [
      {
        full_name: 'Valid User',
        email: 'valid@partner.com',
        account_expires_at: futureDate,
      },
      {
        full_name: 'No Photo',
        email: 'nophoto@partner.com',
        account_expires_at: futureDate,
      },
      {
        full_name: 'Bad Email',
        email: 'invalid-email',
        account_expires_at: futureDate,
      },
      {
        full_name: 'No Expire',
        email: 'noexpire@partner.com',
        account_expires_at: '',
      },
    ];
    const xlsxBuf = await buildXlsx(rows);

    const photos = [
      {
        buffer: VALID_PNG_BUFFER,
        originalname: 'valid@partner.com.png',
        size: VALID_PNG_BUFFER.length,
      },
    ];

    const report = await service.importPartnerAccounts(
      fileOf(xlsxBuf),
      photos,
      undefined,
      { commit: false },
      actor,
      ctx,
    );

    expect(report.mode).toBe('preview');
    expect(report.totalRows).toBe(4);
    expect(report.validCount).toBe(1);
    expect(report.invalidCount).toBe(3);

    expect(
      report.results.find((r) => r.email === 'valid@partner.com')?.status,
    ).toBe('valid');
    expect(
      report.results.find((r) => r.email === 'nophoto@partner.com')?.reason,
    ).toBe(ImportPartnerAccountRowReason.PARTNER_PHOTO_REQUIRED);
    expect(
      report.results.find((r) => r.email === 'invalid-email')?.reason,
    ).toBe(ImportPartnerAccountRowReason.INVALID_EMAIL);
    expect(
      report.results.find((r) => r.email === 'noexpire@partner.com')?.reason,
    ).toBe(ImportPartnerAccountRowReason.MISSING_ACCOUNT_EXPIRES_AT);

    expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
    expect(usersService.persistAccount).not.toHaveBeenCalled();
  });

  it('commit mode provisions valid partner user, uploads photo, sends email and audits', async () => {
    const futureDate = new Date(Date.now() + 86400 * 1000 * 2).toISOString();
    const rows = [
      {
        full_name: 'Doi Tac 1',
        email: 'partner1@doitac.com',
        account_expires_at: futureDate,
        license_plate: '30A12345',
      },
    ];
    const xlsxBuf = await buildXlsx(rows);

    const photos = [
      {
        buffer: VALID_PNG_BUFFER,
        originalname: 'partner1@doitac.com.png',
        size: VALID_PNG_BUFFER.length,
      },
    ];

    const report = await service.importPartnerAccounts(
      fileOf(xlsxBuf),
      photos,
      undefined,
      { commit: true },
      actor,
      ctx,
    );

    expect(report.mode).toBe('commit');
    expect(report.successCount).toBe(1);
    expect(report.failedCount).toBe(0);
    expect(report.results[0].status).toBe('success');
    expect(report.results[0].vehiclePlateStatus).toBe('attached');

    expect(cloudinaryService.uploadImage).toHaveBeenCalled();
    expect(usersService.persistAccount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fullName: 'Doi Tac 1',
        email: 'partner1@doitac.com',
        departmentId: PARTNER_DEPARTMENT_ID,
      }),
      'admin-1',
      ctx,
    );
    expect(vehicleRegistrationService.register).toHaveBeenCalled();
    expect(notificationsService.enqueueEmailNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIds: ['user-partner1@doitac.com'],
      }),
    );

    // Audit tổng PARTNER_ACCOUNT_IMPORT phải ghi qua đúng entity/property
    // (userId/entityType/actionType) — KHÔNG raw insert cột không tồn tại
    // (bug đã sửa: actor_id/thiếu entity_type → insert luôn fail thật trên DB).
    expect(dataSource.manager.save).toHaveBeenCalledWith(
      AuditLogEntity,
      expect.objectContaining({
        userId: 'admin-1',
        actionType: 'PARTNER_ACCOUNT_IMPORT',
        entityType: 'users',
        newValueJson: expect.objectContaining({
          totalRows: 1,
          successCount: 1,
          failedCount: 0,
        }),
      }),
    );
  });

  it('commit: biển số sai định dạng → vehiclePlateStatus=invalid_plate (không phải attach_failed)', async () => {
    vehicleRegistrationService.register.mockRejectedValueOnce(
      new BadRequestException({
        code: 'INVALID_PLATE',
        message:
          'Biển số không hợp lệ (cần 6–10 ký tự chữ-số, có cả chữ và số).',
      }),
    );
    const futureDate = new Date(Date.now() + 86400 * 1000 * 2).toISOString();
    const rows = [
      {
        full_name: 'Doi Tac 2',
        email: 'partner2@doitac.com',
        account_expires_at: futureDate,
        license_plate: 'AB',
      },
    ];
    const xlsxBuf = await buildXlsx(rows);
    const photos = [
      {
        buffer: VALID_PNG_BUFFER,
        originalname: 'partner2@doitac.com.png',
        size: VALID_PNG_BUFFER.length,
      },
    ];

    const report = await service.importPartnerAccounts(
      fileOf(xlsxBuf),
      photos,
      undefined,
      { commit: true },
      actor,
      ctx,
    );

    expect(report.results[0].status).toBe('success');
    expect(report.results[0].vehiclePlateStatus).toBe('invalid_plate');
  });

  it('commit: biển số trùng → vehiclePlateStatus=duplicate_plate, tài khoản vẫn success', async () => {
    vehicleRegistrationService.register.mockRejectedValueOnce(
      new ConflictException({
        code: 'PLATE_ALREADY_REGISTERED',
        message: 'Biển số này đã được đăng ký',
      }),
    );
    const futureDate = new Date(Date.now() + 86400 * 1000 * 2).toISOString();
    const rows = [
      {
        full_name: 'Doi Tac 3',
        email: 'partner3@doitac.com',
        account_expires_at: futureDate,
        license_plate: '30A12345',
      },
    ];
    const xlsxBuf = await buildXlsx(rows);
    const photos = [
      {
        buffer: VALID_PNG_BUFFER,
        originalname: 'partner3@doitac.com.png',
        size: VALID_PNG_BUFFER.length,
      },
    ];

    const report = await service.importPartnerAccounts(
      fileOf(xlsxBuf),
      photos,
      undefined,
      { commit: true },
      actor,
      ctx,
    );

    expect(report.results[0].status).toBe('success');
    expect(report.results[0].vehiclePlateStatus).toBe('duplicate_plate');
  });

  it('supports defaultExpiresInDays when account_expires_at is omitted', async () => {
    const rows = [
      {
        full_name: 'Doi Tac Default',
        email: 'default@doitac.com',
        account_expires_at: '',
      },
    ];
    const xlsxBuf = await buildXlsx(rows);
    const photos = [
      {
        buffer: VALID_PNG_BUFFER,
        originalname: 'default@doitac.com.png',
        size: VALID_PNG_BUFFER.length,
      },
    ];

    const report = await service.importPartnerAccounts(
      fileOf(xlsxBuf),
      photos,
      undefined,
      { commit: false, defaultExpiresInDays: 3 },
      actor,
      ctx,
    );

    expect(report.validCount).toBe(1);
    expect(report.results[0].status).toBe('valid');
    expect(report.results[0].accountExpiresAt).toBeDefined();
  });
});
