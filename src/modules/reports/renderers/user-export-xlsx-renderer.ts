import * as ExcelJS from 'exceljs';
import type { UserExportRow } from '../services/user-export-data.service.js';

export interface UserExportMeta {
  generatedAt: Date;
  extractedByEmail: string;
}

/**
 * renderUserExportXlsx (BE-04) — 1 sheet, 1 dòng/user. Mirror style
 * renderGateAccessXlsx (renderers/gate-access-xlsx-renderer.ts).
 */
export async function renderUserExportXlsx(
  rows: UserExportRow[],
  meta: UserExportMeta,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SmartTracking System';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Danh sách người dùng');

  sheet.mergeCells('A1:H1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'DANH SÁCH NGƯỜI DÙNG';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:H2');
  sheet.getCell('A2').value =
    `Người tạo: ${meta.extractedByEmail}  |  Thời điểm xuất: ${meta.generatedAt.toISOString()}  |  Tổng số: ${rows.length}`;
  sheet.getCell('A2').alignment = { horizontal: 'center' };
  sheet.addRow([]);

  const headerRow = sheet.addRow([
    'Mã NV',
    'Họ tên',
    'Email',
    'Số điện thoại',
    'Phòng ban (ID)',
    'Trạng thái',
    'Vai trò',
    'Ngày tạo',
  ]);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDCE6F1' },
    };
    cell.border = { bottom: { style: 'thin' } };
  });

  for (const row of rows) {
    sheet.addRow([
      row.employeeCode ?? '',
      row.fullName,
      row.email,
      row.phoneNumber ?? '',
      row.departmentId ?? '',
      row.accountStatus,
      row.roles.join(', '),
      row.createdAt.toISOString(),
    ]);
  }

  sheet.columns.forEach((col) => {
    col.width = 22;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
