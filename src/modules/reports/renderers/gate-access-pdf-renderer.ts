import PDFDocument from 'pdfkit';
import type { GateAccessExportRow } from '../services/gate-access-report-data.service.js';
import {
  registerVietnamesePdfFonts,
  VN_FONT_REGULAR,
  VN_FONT_BOLD,
} from '../../../common/utils/pdf-font.util.js';

export interface GateAccessReportMeta {
  from: string;
  to: string;
  generatedAt: Date;
  extractedByEmail: string;
}

/**
 * renderGateAccessPdf — UC-127.
 * Bảng 1 dòng/1 phiên đã ghép cặp (chỉ session_status='completed'), kèm tổng hợp đầu trang.
 */
export function renderGateAccessPdf(
  rows: GateAccessExportRow[],
  meta: GateAccessReportMeta,
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
        .text('BÁO CÁO RA VÀO KHUÔN VIÊN', { align: 'center' });
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

      doc.font(VN_FONT_REGULAR).fontSize(10).text(`Tổng số phiên: ${rows.length}`);
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

      const colW = [70, 110, 70, 100, 90, 70, 95, 95, 60];
      const headers = [
        'Cổng',
        'Tên cổng',
        'Mã NV',
        'Họ tên',
        'Phòng ban',
        'Biển số',
        'Giờ vào',
        'Giờ ra',
        'Thời lượng',
      ];
      const startX = 40;
      const colX: number[] = [];
      let cursor = startX;
      for (const w of colW) {
        colX.push(cursor);
        cursor += w;
      }

      const drawHeader = (): void => {
        doc.font(VN_FONT_BOLD).fontSize(8);
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
      doc.font(VN_FONT_REGULAR).fontSize(7.5);

      rows.forEach((row) => {
        if (doc.y > 520) {
          doc.addPage();
          drawHeader();
          doc.font(VN_FONT_REGULAR).fontSize(7.5);
        }
        const y = doc.y;
        const durationStr =
          row.durationSeconds != null
            ? `${Math.round(row.durationSeconds / 60)} phút`
            : '—';
        doc.text(row.zoneCode ?? '—', colX[0], y, { width: colW[0] });
        doc.text(truncate(row.zoneName ?? '—', 20), colX[1], y, {
          width: colW[1],
        });
        doc.text(row.employeeCode ?? '—', colX[2], y, { width: colW[2] });
        doc.text(truncate(row.fullName ?? '—', 18), colX[3], y, {
          width: colW[3],
        });
        doc.text(truncate(row.departmentName ?? '—', 16), colX[4], y, {
          width: colW[4],
        });
        doc.text(row.plateNumber ?? '—', colX[5], y, { width: colW[5] });
        doc.text(
          row.checkInTime ? row.checkInTime.toLocaleString('vi-VN') : '—',
          colX[6],
          y,
          { width: colW[6] },
        );
        doc.text(
          row.checkOutTime ? row.checkOutTime.toLocaleString('vi-VN') : '—',
          colX[7],
          y,
          { width: colW[7] },
        );
        doc.text(durationStr, colX[8], y, { width: colW[8] });
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
