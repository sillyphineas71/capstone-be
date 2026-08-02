import PDFDocument from 'pdfkit';
import type {
  SecurityAlertExportRow,
  SecurityAlertStatusCounts,
} from '../services/security-alert-report-data.service.js';
import {
  registerVietnamesePdfFonts,
  VN_FONT_REGULAR,
  VN_FONT_BOLD,
} from '../../../common/utils/pdf-font.util.js';

export interface SecurityAlertReportMeta {
  from: string;
  to: string;
  generatedAt: Date;
  extractedByEmail: string;
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Mới',
  acknowledged: 'Đã tiếp nhận',
  resolved: 'Đã xử lý',
};

/**
 * renderSecurityAlertPdf — UC-129.
 * Bảng 1 dòng/1 cảnh báo + tổng hợp đầu trang (tổng số + phân bổ theo status).
 */
export function renderSecurityAlertPdf(
  rows: SecurityAlertExportRow[],
  statusCounts: SecurityAlertStatusCounts,
  meta: SecurityAlertReportMeta,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        layout: 'landscape',
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      registerVietnamesePdfFonts(doc);

      doc
        .font(VN_FONT_BOLD)
        .fontSize(16)
        .text('BÁO CÁO SỰ KIỆN AN NINH', { align: 'center' });
      doc.moveDown(0.3);
      doc
        .font(VN_FONT_REGULAR)
        .fontSize(9)
        .fillColor('#666666')
        .text(
          `Kỳ báo cáo: ${meta.from} → ${meta.to}  ·  Người tạo: ${meta.extractedByEmail}  ·  Tạo lúc: ${meta.generatedAt.toLocaleString('vi-VN')}`,
          { align: 'center' },
        );
      doc.fillColor('#000000');
      doc.moveDown(0.5);

      doc
        .font(VN_FONT_REGULAR)
        .fontSize(10)
        .text(
          `Tổng số: ${rows.length}  ·  Mới: ${statusCounts.new}  ·  Đã tiếp nhận: ${statusCounts.acknowledged}  ·  Đã xử lý: ${statusCounts.resolved}`,
        );
      doc.moveDown(0.5);

      if (rows.length === 0) {
        doc
          .font(VN_FONT_REGULAR)
          .fontSize(11)
          .fillColor('#888888')
          .text('Không có dữ liệu trong khoảng thời gian đã chọn.');
        doc.fillColor('#000000');
        doc.end();
        return;
      }

      const colW = [80, 60, 100, 80, 95, 95, 95, 95, 120];
      const headers = [
        'Loại',
        'Mức độ',
        'Khu vực',
        'Trạng thái',
        'Thời điểm',
        'Người tiếp nhận',
        'Người xử lý',
        'Thời điểm xử lý',
        'Ghi chú',
      ];
      const startX = 40;
      const colX: number[] = [];
      let cursor = startX;
      for (const w of colW) {
        colX.push(cursor);
        cursor += w;
      }

      const drawHeader = (): void => {
        doc.font(VN_FONT_BOLD).fontSize(7.5);
        const y = doc.y;
        headers.forEach((h, i) => doc.text(h, colX[i], y, { width: colW[i] }));
        doc.y = y + 14;
        doc
          .moveTo(startX, doc.y)
          .lineTo(colX[colX.length - 1] + colW[colW.length - 1], doc.y)
          .stroke('#cccccc');
        doc.y += 4;
      };

      drawHeader();
      doc.font(VN_FONT_REGULAR).fontSize(7);

      rows.forEach((row) => {
        if (doc.y > 520) {
          doc.addPage();
          drawHeader();
          doc.font(VN_FONT_REGULAR).fontSize(7);
        }
        const y = doc.y;
        doc.text(row.alertType, colX[0], y, { width: colW[0] });
        doc.text(row.severity, colX[1], y, { width: colW[1] });
        doc.text(truncate(row.zoneName, 18), colX[2], y, { width: colW[2] });
        doc.text(STATUS_LABEL[row.status] ?? row.status, colX[3], y, {
          width: colW[3],
        });
        doc.text(row.triggeredAt.toLocaleString('vi-VN'), colX[4], y, {
          width: colW[4],
        });
        doc.text(row.acknowledgedByName ?? '—', colX[5], y, { width: colW[5] });
        doc.text(row.resolvedByName ?? '—', colX[6], y, { width: colW[6] });
        doc.text(
          row.resolvedAt ? row.resolvedAt.toLocaleString('vi-VN') : '—',
          colX[7],
          y,
          { width: colW[7] },
        );
        doc.text(truncate(row.resolutionNote ?? '—', 24), colX[8], y, {
          width: colW[8],
        });
        doc.y = y + 12;
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function truncate(s: string, maxLen: number): string {
  if (!s) return '—';
  const chars = Array.from(s);
  return chars.length > maxLen ? chars.slice(0, maxLen - 1).join('') + '…' : s;
}
