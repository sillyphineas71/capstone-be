import PDFDocument from 'pdfkit';
import { MinutesExportData } from './meeting-minutes-export-data.js';

/**
 * renderMeetingMinutesPdf (UC-147, FR-001/FR-003/FR-012).
 * Render biên bản họp ra PDF bằng pdfkit (đã có sẵn trong package.json).
 * Mirror pattern reports/renderers/meeting-activity-pdf-renderer.ts.
 *
 * @returns Buffer chứa file PDF
 */
export function renderMeetingMinutesPdf(
  data: MinutesExportData,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Header ──
      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .text('BIÊN BẢN CUỘC HỌP', { align: 'center' });
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(13).text(data.title, {
        align: 'center',
      });
      doc.moveDown(0.5);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#666666')
        .text(
          `Cuộc họp: ${data.meetingTitle ?? '-'}    |    Trạng thái: ${data.status}` +
            (data.issuedAt
              ? `    |    Ban hành: ${data.issuedAt.toLocaleString('vi-VN')}`
              : ''),
          { align: 'center' },
        );
      doc
        .fontSize(9)
        .text(`Xuất lúc: ${data.generatedAt.toLocaleString('vi-VN')}`, {
          align: 'center',
        });
      doc.fillColor('#000000');
      doc.moveDown(1);

      // ── Nội dung chính ──
      section(doc, '1. Nội dung biên bản');
      doc
        .font('Helvetica')
        .fontSize(11)
        .text(data.minutesContent || '(Chưa có nội dung)', {
          align: 'left',
        });
      doc.moveDown(1);

      // ── Quyết định ──
      section(doc, '2. Quyết định');
      if (data.decisions.length === 0) {
        doc.font('Helvetica-Oblique').fontSize(11).text('(Không có)');
      } else {
        doc.font('Helvetica').fontSize(11);
        data.decisions.forEach((d, i) => doc.text(`${i + 1}. ${d}`));
      }
      doc.moveDown(1);

      // ── Action items (tùy chọn) ──
      if (data.includeActionItems) {
        section(doc, '3. Đầu việc (Action items)');
        if (data.actionItems.length === 0) {
          doc.font('Helvetica-Oblique').fontSize(11).text('(Không có)');
        } else {
          doc.font('Helvetica').fontSize(11);
          data.actionItems.forEach((a, i) => doc.text(`${i + 1}. ${a}`));
        }
        doc.moveDown(1);
      }

      // ── Transcript (tùy chọn) ──
      if (data.transcriptText) {
        section(doc, '4. Bản ghi lời (Transcript)');
        doc.font('Helvetica').fontSize(10).text(data.transcriptText, {
          align: 'left',
        });
      }

      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function section(doc: PDFKit.PDFDocument, title: string): void {
  doc.font('Helvetica-Bold').fontSize(13).text(title);
  doc.moveDown(0.2);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#aaaaaa');
  doc.moveDown(0.4);
}
