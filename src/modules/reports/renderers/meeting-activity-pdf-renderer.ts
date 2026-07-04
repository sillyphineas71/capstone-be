import PDFDocument from 'pdfkit';
import {
  ReportMetadata,
  CoreKpis,
  StatusBreakdownItem,
  MeetingDetailItem,
} from '../services/meeting-activity-report-data.service.js';

export interface ReportData {
  metadata: ReportMetadata;
  kpis: CoreKpis;
  statusBreakdown: StatusBreakdownItem[];
  meetingDetails: MeetingDetailItem[];
}

/**
 * renderMeetingActivityPdf — T026 [FR-027].
 * Render báo cáo hoạt động cuộc họp dưới dạng PDF.
 * Sử dụng pdfkit (đã có sẵn trong package.json).
 *
 * Layout 4 phần:
 *  Phần 1 — Thông tin báo cáo (metadata)
 *  Phần 2 — KPI tổng quan (meeting count, utilization, no-show, on-time)
 *  Phần 3 — Phân bổ trạng thái cuộc họp (bảng)
 *  Phần 4 — Danh sách chi tiết cuộc họp (bảng)
 *
 * @returns Buffer chứa file PDF
 */
export function renderMeetingActivityPdf(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Header ────────────────────────────────────────────────────
      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .text('BÁO CÁO TỔNG HỢP HOẠT ĐỘNG CUỘC HỌP', { align: 'center' });
      doc.moveDown(0.5);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#666666')
        .text(
          `Tạo lúc: ${data.metadata.generatedAt.toLocaleString('vi-VN')}`,
          { align: 'center' },
        );
      doc.fillColor('#000000');
      doc.moveDown(1);

      // ── Phần 1: Thông tin báo cáo ────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(13).text('1. Thông tin báo cáo');
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#aaaaaa');
      doc.moveDown(0.5);

      doc.font('Helvetica').fontSize(10);
      const { metadata } = data;
      const kv = [
        ['Phạm vi tổ chức', metadata.organizationLabel],
        ['Kỳ báo cáo', `${metadata.period.from} → ${metadata.period.to}`],
        ['Người tạo', metadata.extractedByEmail],
      ];
      kv.forEach(([label, value]) => {
        doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
        doc.font('Helvetica').text(value ?? '—');
      });
      doc.moveDown(1);

      // ── Phần 2: KPI tổng quan ─────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(13).text('2. KPI tổng quan');
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#aaaaaa');
      doc.moveDown(0.5);

      const kpiRows = [
        ['Tổng số cuộc họp', data.kpis.meetingCount.toLocaleString('vi-VN')],
        [
          'Tỷ lệ sử dụng phòng (Reservation Utilization)',
          `${data.kpis.reservationUtilizationRate.toFixed(2)}%`,
        ],
        [
          'Tỷ lệ no-show',
          `${data.kpis.noShowRate.toFixed(2)}%`,
        ],
        [
          'Tỷ lệ đúng giờ (On-time Rate)',
          `${data.kpis.onTimeRate.toFixed(2)}%`,
        ],
      ];
      kpiRows.forEach(([label, value]) => {
        doc.font('Helvetica').fontSize(10);
        doc.font('Helvetica-Bold').text(`• ${label}: `, { continued: true });
        doc.font('Helvetica').text(value);
      });
      doc.moveDown(1);

      // ── Phần 3: Phân bổ trạng thái ───────────────────────────────
      doc.font('Helvetica-Bold').fontSize(13).text('3. Phân bổ trạng thái cuộc họp');
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#aaaaaa');
      doc.moveDown(0.5);

      // Header row
      const statusColW = [180, 80, 80];
      const statusX = [50, 230, 310];
      doc.font('Helvetica-Bold').fontSize(10);
      const statusHeaderY = doc.y;
      doc.text('Trạng thái', statusX[0], statusHeaderY, { width: statusColW[0] });
      doc.text('Số lượng', statusX[1], statusHeaderY, { width: statusColW[1] });
      doc.text('Tỷ lệ (%)', statusX[2], statusHeaderY, { width: statusColW[2] });
      doc.y = statusHeaderY + 15;
      doc.moveTo(50, doc.y).lineTo(450, doc.y).stroke('#cccccc');
      doc.y += 5;

      data.statusBreakdown.forEach((item) => {
        doc.font('Helvetica').fontSize(10);
        const rowY = doc.y;
        doc.text(item.status, statusX[0], rowY, { width: statusColW[0] });
        doc.text(item.count.toString(), statusX[1], rowY, { width: statusColW[1] });
        doc.text(`${item.percentage.toFixed(2)}%`, statusX[2], rowY, {
          width: statusColW[2],
        });
        doc.y = rowY + 15;
      });
      doc.y += 10;

      // ── Phần 4: Danh sách chi tiết ───────────────────────────────
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(13).text('4. Danh sách chi tiết cuộc họp');
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#aaaaaa');
      doc.moveDown(0.5);

      // Table header
      const detailColW = [90, 80, 90, 60, 65, 60];
      const detailX = [50, 140, 220, 310, 370, 435];
      const detailHeaders = [
        'Tên cuộc họp',
        'Tổ chức viên',
        'Phòng họp',
        'Bắt đầu',
        'Trạng thái',
        'Tham dự (%)',
      ];

      doc.font('Helvetica-Bold').fontSize(8);
      const dHeaderY = doc.y;
      detailHeaders.forEach((h, i) => {
        doc.text(h, detailX[i], dHeaderY, { width: detailColW[i] });
      });
      doc.y = dHeaderY + 15;
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
      doc.y += 5;

      // Table rows
      doc.font('Helvetica').fontSize(7.5);
      data.meetingDetails.forEach((row) => {
        if (doc.y > 750) {
          doc.addPage();
          doc.font('Helvetica-Bold').fontSize(8);
          const newHeaderY = doc.y;
          detailHeaders.forEach((h, i) => {
            doc.text(h, detailX[i], newHeaderY, { width: detailColW[i] });
          });
          doc.y = newHeaderY + 15;
          doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
          doc.y += 5;
          doc.font('Helvetica').fontSize(7.5);
        }

        const rowY = doc.y;
        const startStr = row.startTime
          ? row.startTime.toLocaleDateString('vi-VN')
          : '—';

        doc.text(truncate(row.title, 20), detailX[0], rowY, {
          width: detailColW[0],
        });
        doc.text(truncate(row.organizerEmail ?? '—', 18), detailX[1], rowY, {
          width: detailColW[1],
        });
        doc.text(truncate(row.roomName ?? '—', 18), detailX[2], rowY, {
          width: detailColW[2],
        });
        doc.text(startStr, detailX[3], rowY, { width: detailColW[3] });
        doc.text(row.status, detailX[4], rowY, { width: detailColW[4] });
        doc.text(`${row.participationRate.toFixed(1)}%`, detailX[5], rowY, {
          width: detailColW[5],
        });
        doc.y = rowY + 12;
      });

      if (data.meetingDetails.length === 0) {
        doc.font('Helvetica').fontSize(10).fillColor('#888888')
          .text('Không có cuộc họp nào trong kỳ báo cáo.');
        doc.fillColor('#000000');
      }

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
