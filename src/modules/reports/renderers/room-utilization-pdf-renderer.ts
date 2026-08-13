import PDFDocument from 'pdfkit';
import {
  ReportMetadata,
  UtilizationSection,
  NoShowSection,
  RoomUsageRow,
  ReleasedRoomRow,
} from '../services/room-utilization-report-data.service.js';
import {
  registerVietnamesePdfFonts,
  VN_FONT_REGULAR,
  VN_FONT_BOLD,
} from '../../../common/utils/pdf-font.util.js';

export interface RoomUtilizationReportData {
  metadata: ReportMetadata;
  utilization: UtilizationSection;
  noShow: NoShowSection;
  usageByRoom: RoomUsageRow[];
  releasedRooms: ReleasedRoomRow[];
}

/**
 * renderRoomUtilizationPdf — UC-RUM-16.
 * Layout: thông tin chung + Utilization Rate + No-show Rate + bảng Actual
 * Usage theo phòng + bảng Released Rooms. Dạng bảng/số liệu có cấu trúc
 * (không render chart ảnh thật — CL-2 spec.md), mirror renderer pdfkit của
 * UC-AA-12 để nhất quán convention.
 */
export function renderRoomUtilizationPdf(
  data: RoomUtilizationReportData,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      registerVietnamesePdfFonts(doc);

      doc
        .font(VN_FONT_BOLD)
        .fontSize(18)
        .text('BÁO CÁO SỬ DỤNG PHÒNG HỌP', { align: 'center' });
      doc.moveDown(0.5);
      doc
        .font(VN_FONT_REGULAR)
        .fontSize(10)
        .fillColor('#666666')
        .text(`Tạo lúc: ${data.metadata.generatedAt.toLocaleString('vi-VN')}`, {
          align: 'center',
        });
      doc.fillColor('#000000');
      doc.moveDown(1);

      // Phần 0: Thông tin chung
      sectionHeader(doc, '1. Thông tin chung');
      kvRow(doc, 'Phạm vi', data.metadata.organizationLabel);
      kvRow(
        doc,
        'Kỳ báo cáo',
        `${data.metadata.period.from} → ${data.metadata.period.to}`,
      );
      kvRow(doc, 'Người tạo', data.metadata.extractedByEmail);
      doc.moveDown(1);

      // Phần 1: Utilization Rate
      sectionHeader(doc, '2. Tỷ lệ lấp đầy (Utilization Rate)');
      kvRow(
        doc,
        'Tỷ lệ lấp đầy (Reservation)',
        `${data.utilization.reservationUtilizationRate.toFixed(1)}%`,
      );
      kvRow(
        doc,
        'Tỷ lệ sử dụng thực tế (Occupancy)',
        `${data.utilization.roomOccupancyRate.toFixed(1)}%`,
      );
      kvRow(
        doc,
        'Số giờ đã đặt',
        `${data.utilization.bookedHours.toFixed(1)}h`,
      );
      kvRow(
        doc,
        'Số giờ sử dụng thực tế',
        `${data.utilization.actualHours.toFixed(1)}h`,
      );
      kvRow(
        doc,
        'Số giờ khả dụng',
        `${data.utilization.availableHours.toFixed(1)}h`,
      );
      doc.moveDown(1);

      // Phần 2: No-show Rate
      sectionHeader(doc, '3. Tỷ lệ vắng mặt (No-show Rate)');
      kvRow(doc, 'Số lượt No-show', data.noShow.noShowCount.toString());
      kvRow(
        doc,
        'Tổng số lượt đặt phòng',
        data.noShow.totalBookings.toString(),
      );
      kvRow(doc, 'Tỷ lệ No-show', `${data.noShow.noShowRate.toFixed(1)}%`);
      doc.moveDown(1);

      // Phần 3: Actual Usage theo phòng
      doc.addPage();
      sectionHeader(doc, '4. Số giờ sử dụng thực tế theo phòng');
      const usageHeaders = ['Phòng', 'Giờ đã đặt', 'Giờ sử dụng', 'Tỷ lệ (%)'];
      const usageColW = [200, 90, 90, 80];
      const usageX = [50, 250, 340, 430];
      tableHeader(doc, usageHeaders, usageX, usageColW);
      data.usageByRoom.forEach((row) => {
        tableRow(
          doc,
          [
            row.roomName,
            `${row.bookedHours.toFixed(1)}h`,
            `${row.actualHours.toFixed(1)}h`,
            `${row.roomOccupancyRate.toFixed(1)}%`,
          ],
          usageX,
          usageColW,
        );
      });
      if (data.usageByRoom.length === 0) {
        emptyNote(doc, 'Không có dữ liệu sử dụng phòng trong kỳ báo cáo.');
      }
      doc.y += 10;

      // Phần 4: Released Rooms
      doc.addPage();
      sectionHeader(doc, '5. Danh sách phòng bị thu hồi');
      const relHeaders = ['Phòng', 'Loại', 'Thời điểm', 'Trạng thái cũ → mới'];
      const relColW = [150, 130, 130, 110];
      const relX = [50, 200, 330, 460];
      tableHeader(doc, relHeaders, relX, relColW);
      data.releasedRooms.forEach((row) => {
        tableRow(
          doc,
          [
            row.roomName,
            row.eventType === 'room_auto_released'
              ? 'Tự động (No-show)'
              : 'Thủ công',
            row.eventTime.toLocaleString('vi-VN'),
            `${row.oldStatus ?? '—'} → ${row.newStatus ?? '—'}`,
          ],
          relX,
          relColW,
        );
      });
      if (data.releasedRooms.length === 0) {
        emptyNote(doc, 'Không có phòng nào bị thu hồi trong kỳ báo cáo.');
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function sectionHeader(doc: PDFKit.PDFDocument, title: string): void {
  doc.font(VN_FONT_BOLD).fontSize(13).text(title);
  doc.moveDown(0.3);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#aaaaaa');
  doc.moveDown(0.5);
}

function kvRow(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc.font(VN_FONT_BOLD).fontSize(10).text(`${label}: `, { continued: true });
  doc.font(VN_FONT_REGULAR).text(value ?? '—');
}

function tableHeader(
  doc: PDFKit.PDFDocument,
  headers: string[],
  x: number[],
  w: number[],
): void {
  doc.font(VN_FONT_BOLD).fontSize(9);
  const y = doc.y;
  headers.forEach((h, i) => doc.text(h, x[i], y, { width: w[i] }));
  doc.y = y + 15;
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
  doc.y += 5;
}

function tableRow(
  doc: PDFKit.PDFDocument,
  cells: string[],
  x: number[],
  w: number[],
): void {
  if (doc.y > 750) {
    doc.addPage();
    doc.y = 50;
  }
  doc.font(VN_FONT_REGULAR).fontSize(8.5);
  const y = doc.y;
  cells.forEach((c, i) => doc.text(c, x[i], y, { width: w[i] }));
  doc.y = y + 14;
}

function emptyNote(doc: PDFKit.PDFDocument, text: string): void {
  doc.font(VN_FONT_REGULAR).fontSize(10).fillColor('#888888').text(text);
  doc.fillColor('#000000');
}
