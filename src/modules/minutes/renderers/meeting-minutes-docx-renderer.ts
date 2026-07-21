import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  AlignmentType,
} from 'docx';
import { MinutesExportData } from './meeting-minutes-export-data.js';

/**
 * renderMeetingMinutesDocx (UC-147, FR-012).
 * Render biên bản họp ra Word (.docx) bằng thư viện `docx`.
 * Layout tương đương bản PDF (không cần pixel-perfect).
 *
 * @returns Buffer chứa file .docx
 */
export async function renderMeetingMinutesDocx(
  data: MinutesExportData,
): Promise<Buffer> {
  const children: Paragraph[] = [];

  // ── Header ──
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'BIÊN BẢN CUỘC HỌP', bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: data.title, bold: true, size: 26 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text:
            `Cuộc họp: ${data.meetingTitle ?? '-'}  |  Trạng thái: ${data.status}` +
            (data.issuedAt
              ? `  |  Ban hành: ${data.issuedAt.toLocaleString('vi-VN')}`
              : ''),
          italics: true,
          size: 18,
          color: '666666',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Xuất lúc: ${data.generatedAt.toLocaleString('vi-VN')}`,
          italics: true,
          size: 16,
          color: '999999',
        }),
      ],
    }),
    new Paragraph({ text: '' }),
  );

  // ── Nội dung chính ──
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      text: '1. Nội dung biên bản',
    }),
  );
  for (const line of (data.minutesContent || '(Chưa có nội dung)').split(
    '\n',
  )) {
    children.push(new Paragraph({ text: line }));
  }

  // ── Quyết định ──
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, text: '2. Quyết định' }),
  );
  if (data.decisions.length === 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: '(Không có)', italics: true })],
      }),
    );
  } else {
    data.decisions.forEach((d) =>
      children.push(new Paragraph({ text: d, bullet: { level: 0 } })),
    );
  }

  // ── Action items (tùy chọn) ──
  if (data.includeActionItems) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        text: '3. Đầu việc (Action items)',
      }),
    );
    if (data.actionItems.length === 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: '(Không có)', italics: true })],
        }),
      );
    } else {
      data.actionItems.forEach((a) =>
        children.push(new Paragraph({ text: a, bullet: { level: 0 } })),
      );
    }
  }

  // ── Transcript (tùy chọn) ──
  if (data.transcriptText) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        text: '4. Bản ghi lời (Transcript)',
      }),
    );
    for (const line of data.transcriptText.split('\n')) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: line, size: 20 })] }),
      );
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}
