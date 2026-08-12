import * as ExcelJS from 'exceljs';
import type { AuditLogItemDto } from '../dto/audit-log-response.dto.js';
import {
  translateActionTypeToVn,
  translateEntityTypeToVn,
  translateSeverityToVn,
} from '../constants/audit-log-vn-labels.constant.js';

export interface AuditLogExportMeta {
  generatedAt: Date;
  extractedByEmail: string;
  from: string;
  to: string;
  totalMatching: number;
  returnedCount: number;
  maxRows: number;
}

const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** Format theo giờ Việt Nam, dạng dd/MM/yyyy HH:mm:ss, dễ đọc trong Excel. */
function formatVnDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: VN_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/**
 * renderAuditLogExportXlsx — 1 sheet, 1 dòng/bản ghi audit log, đúng 7 cột
 * theo yêu cầu FE (Docs/Nam_Sent/be-audit-log-export-requirement.md §3):
 * Thời gian, Người thực hiện, Mã người thực hiện, Hành động, Loại đối tượng,
 * Mã đối tượng, Mức độ. KHÔNG oldValueJson/newValueJson/metadataJson/
 * ipAddress/userAgent/requestId. Mirror style renderUserExportXlsx
 * (reports/renderers/user-export-xlsx-renderer.ts).
 *
 * actionType/entityType/severity được dịch sang tiếng Việt chuẩn hóa qua
 * constants/audit-log-vn-labels.constant.ts (§2 tài liệu FE) — CHỈ áp dụng
 * cho file Excel, KHÔNG ảnh hưởng response JSON GET /audit-logs.
 *
 * Nếu `meta.returnedCount < meta.totalMatching` (bị cắt bởi MAX_EXPORT_ROWS),
 * thêm 1 dòng cảnh báo tô đỏ ở cuối — tránh mất dữ liệu âm thầm trên audit
 * trail bảo mật (người dùng phải thấy rõ file chưa đầy đủ).
 */
export async function renderAuditLogExportXlsx(
  rows: AuditLogItemDto[],
  meta: AuditLogExportMeta,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SmartTracking System';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Nhật ký hệ thống');

  sheet.mergeCells('A1:G1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'NHẬT KÝ KIỂM TRA HỆ THỐNG';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:G2');
  sheet.getCell('A2').value =
    `Người xuất: ${meta.extractedByEmail}  |  Thời điểm xuất: ${formatVnDateTime(meta.generatedAt)}  |  ` +
    `Khoảng thời gian: ${meta.from} → ${meta.to}  |  Số dòng xuất: ${meta.returnedCount}/${meta.totalMatching}`;
  sheet.getCell('A2').alignment = { horizontal: 'center' };
  sheet.addRow([]);

  const headerRow = sheet.addRow([
    'Thời gian',
    'Người thực hiện',
    'Mã người thực hiện',
    'Hành động',
    'Loại đối tượng',
    'Mã đối tượng',
    'Mức độ',
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
      formatVnDateTime(row.createdAt),
      row.actorName,
      row.actorUserId ?? '',
      translateActionTypeToVn(row.actionType),
      translateEntityTypeToVn(row.entityType),
      row.entityId ?? '',
      translateSeverityToVn(row.severity),
    ]);
  }

  if (meta.returnedCount < meta.totalMatching) {
    sheet.addRow([]);
    const warningRow = sheet.addRow([
      `⚠ Dữ liệu bị giới hạn ở ${meta.maxRows.toLocaleString('vi-VN')} dòng — còn ${(meta.totalMatching - meta.returnedCount).toLocaleString('vi-VN')} bản ghi khớp bộ lọc chưa được xuất. Thu hẹp khoảng thời gian (from/to) hoặc thêm bộ lọc để xuất đầy đủ.`,
    ]);
    sheet.mergeCells(`A${warningRow.number}:G${warningRow.number}`);
    warningRow.getCell(1).font = { bold: true, color: { argb: 'FFC00000' } };
    warningRow.getCell(1).alignment = { wrapText: true };
  }

  sheet.columns.forEach((col) => {
    col.width = 24;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
