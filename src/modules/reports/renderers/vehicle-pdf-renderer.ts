import PDFDocument from 'pdfkit';
import type { VehicleRegistrationExportRow } from '../services/vehicle-report-data.service.js';
import type { VehicleTrafficStatsResponseDto } from '../../gate-access/dto/vehicle-traffic-stats-response.dto.js';
import {
  registerVietnamesePdfFonts,
  VN_FONT_REGULAR,
  VN_FONT_BOLD,
} from '../../../common/utils/pdf-font.util.js';

export interface VehicleReportMeta {
  from: string;
  to: string;
  generatedAt: Date;
  extractedByEmail: string;
}

export interface VehicleReportData {
  registrations?: VehicleRegistrationExportRow[];
  trafficStats?: VehicleTrafficStatsResponseDto;
}

/**
 * renderVehiclePdf — UC-128.
 * `data.registrations`/`data.trafficStats` đều optional — chỉ render section nào có mặt
 * (theo `content` đã chọn ở tầng worker), KHÔNG trộn 2 nguồn vào cùng bảng (FR-025 spec).
 */
export function renderVehiclePdf(
  data: VehicleReportData,
  meta: VehicleReportMeta,
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
        .text('BÁO CÁO PHƯƠNG TIỆN', { align: 'center' });
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
      doc.moveDown(0.8);

      const hasAnyData =
        (data.registrations && data.registrations.length > 0) ||
        (data.trafficStats && data.trafficStats.summary.total_events > 0);

      if (!hasAnyData) {
        doc
          .font(VN_FONT_REGULAR)
          .fontSize(11)
          .fillColor('#888888')
          .text('Không có dữ liệu trong khoảng thời gian đã chọn.');
        doc.fillColor('#000000');
        doc.end();
        return;
      }

      if (data.registrations) {
        renderRegistrationsSection(doc, data.registrations);
      }

      if (data.trafficStats) {
        if (data.registrations) doc.addPage();
        renderTrafficStatsSection(doc, data.trafficStats);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function renderRegistrationsSection(
  doc: PDFKit.PDFDocument,
  rows: VehicleRegistrationExportRow[],
): void {
  doc.font(VN_FONT_BOLD).fontSize(13).text('Danh sách đăng ký phương tiện');
  doc.moveDown(0.3);
  doc.moveTo(40, doc.y).lineTo(800, doc.y).stroke('#aaaaaa');
  doc.moveDown(0.5);
  doc.font(VN_FONT_REGULAR).fontSize(10).text(`Tổng số: ${rows.length}`);
  doc.moveDown(0.5);

  const colW = [90, 90, 60, 70, 110, 130, 90];
  const headers = [
    'Biển số',
    'Biển gốc',
    'Loại xe',
    'Trạng thái',
    'Mã NV',
    'Chủ xe',
    'Ngày ĐK',
  ];
  const startX = 40;
  const colX: number[] = [];
  let cursor = startX;
  for (const w of colW) {
    colX.push(cursor);
    cursor += w;
  }

  doc.font(VN_FONT_BOLD).fontSize(8);
  const hy = doc.y;
  headers.forEach((h, i) => doc.text(h, colX[i], hy, { width: colW[i] }));
  doc.y = hy + 14;
  doc
    .moveTo(startX, doc.y)
    .lineTo(colX[colX.length - 1] + colW[colW.length - 1], doc.y)
    .stroke('#cccccc');
  doc.y += 4;

  doc.font(VN_FONT_REGULAR).fontSize(7.5);
  rows.forEach((row) => {
    if (doc.y > 520) {
      doc.addPage();
      doc.font(VN_FONT_BOLD).fontSize(8);
      const y2 = doc.y;
      headers.forEach((h, i) => doc.text(h, colX[i], y2, { width: colW[i] }));
      doc.y = y2 + 14;
      doc
        .moveTo(startX, doc.y)
        .lineTo(colX[colX.length - 1] + colW[colW.length - 1], doc.y)
        .stroke('#cccccc');
      doc.y += 4;
      doc.font(VN_FONT_REGULAR).fontSize(7.5);
    }
    const y = doc.y;
    doc.text(row.plateNumber, colX[0], y, { width: colW[0] });
    doc.text(row.plateRaw, colX[1], y, { width: colW[1] });
    doc.text(row.vehicleType ?? '—', colX[2], y, { width: colW[2] });
    doc.text(row.status, colX[3], y, { width: colW[3] });
    doc.text(row.ownerEmployeeCode ?? '—', colX[4], y, { width: colW[4] });
    doc.text(row.ownerFullName ?? '—', colX[5], y, { width: colW[5] });
    doc.text(row.createdAt.toLocaleDateString('vi-VN'), colX[6], y, {
      width: colW[6],
    });
    doc.y = y + 12;
  });
}

function renderTrafficStatsSection(
  doc: PDFKit.PDFDocument,
  stats: VehicleTrafficStatsResponseDto,
): void {
  doc.font(VN_FONT_BOLD).fontSize(13).text('Thống kê lưu lượng phương tiện');
  doc.moveDown(0.3);
  doc.moveTo(40, doc.y).lineTo(800, doc.y).stroke('#aaaaaa');
  doc.moveDown(0.5);

  const s = stats.summary;
  const summaryRows: [string, string][] = [
    ['Tổng sự kiện', String(s.total_events)],
    ['Đã đối chiếu', String(s.total_matched)],
    ['Chưa đối chiếu', String(s.total_unmatched)],
    ['Lượt vào', String(s.total_enter)],
    ['Lượt ra', String(s.total_leave)],
    ['Lượt phát hiện (seen)', String(s.total_seen)],
    ['Số xe duy nhất', String(s.unique_vehicles)],
  ];
  summaryRows.forEach(([label, value]) => {
    doc
      .font(VN_FONT_BOLD)
      .fontSize(10)
      .text(`• ${label}: `, { continued: true });
    doc.font(VN_FONT_REGULAR).text(value);
  });
  doc.moveDown(0.8);

  doc.font(VN_FONT_BOLD).fontSize(11).text('Chuỗi số liệu theo thời gian');
  doc.moveDown(0.3);
  const colW = [140, 80, 80, 80];
  const headers = ['Thời điểm', 'Vào', 'Ra', 'Phát hiện'];
  const startX = 40;
  const colX: number[] = [];
  let cursor = startX;
  for (const w of colW) {
    colX.push(cursor);
    cursor += w;
  }
  doc.font(VN_FONT_BOLD).fontSize(8);
  const hy = doc.y;
  headers.forEach((h, i) => doc.text(h, colX[i], hy, { width: colW[i] }));
  doc.y = hy + 14;
  doc.moveTo(startX, doc.y).lineTo(420, doc.y).stroke('#cccccc');
  doc.y += 4;

  doc.font(VN_FONT_REGULAR).fontSize(8);
  stats.series.forEach((bucket) => {
    const y = doc.y;
    doc.text(bucket.bucket, colX[0], y, { width: colW[0] });
    doc.text(String(bucket.enter), colX[1], y, { width: colW[1] });
    doc.text(String(bucket.leave), colX[2], y, { width: colW[2] });
    doc.text(String(bucket.seen), colX[3], y, { width: colW[3] });
    doc.y = y + 12;
  });
}
