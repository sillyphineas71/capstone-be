import { renderMeetingMinutesPdf } from './meeting-minutes-pdf-renderer.js';
import { renderMeetingMinutesDocx } from './meeting-minutes-docx-renderer.js';
import {
  MinutesExportData,
  normalizeMinutesJsonList,
} from './meeting-minutes-export-data.js';

const baseData: MinutesExportData = {
  title: 'Biên bản họp Sprint 12',
  meetingTitle: 'Sprint Review',
  status: 'published',
  issuedAt: new Date('2026-07-17T03:00:00Z'),
  generatedAt: new Date('2026-07-17T04:00:00Z'),
  minutesContent: '1. Thành phần\n2. Nội dung\n3. Kết luận',
  decisions: ['Chốt release ngày 20/07', 'Tăng ngân sách QA'],
  actionItems: ['Sửa bug login (phụ trách: An) (hạn: 18/07)'],
  includeActionItems: true,
  transcriptText: 'A: Xin chào\nB: Bắt đầu họp',
};

describe('normalizeMinutesJsonList', () => {
  it('returns [] for non-array', () => {
    expect(normalizeMinutesJsonList(null)).toEqual([]);
    expect(normalizeMinutesJsonList({ a: 1 })).toEqual([]);
    expect(normalizeMinutesJsonList(undefined)).toEqual([]);
  });

  it('maps decision objects ({text}) to text', () => {
    expect(
      normalizeMinutesJsonList([{ text: 'Quyết định A', confidence: 'high' }]),
    ).toEqual(['Quyết định A']);
  });

  it('maps action item objects ({task, owner, deadline})', () => {
    const out = normalizeMinutesJsonList([
      { task: 'Làm X', owner: 'An', deadline: '20/07' },
    ]);
    expect(out[0]).toContain('Làm X');
    expect(out[0]).toContain('An');
    expect(out[0]).toContain('20/07');
  });

  it('passes through plain strings, drops empties', () => {
    expect(normalizeMinutesJsonList(['a', '', '  '])).toEqual(['a']);
  });
});

describe('renderMeetingMinutesPdf', () => {
  it('produces a non-empty PDF buffer (magic %PDF)', async () => {
    const buf = await renderMeetingMinutesPdf(baseData);
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('handles empty decisions/actionItems and null transcript without error', async () => {
    const buf = await renderMeetingMinutesPdf({
      ...baseData,
      decisions: [],
      actionItems: [],
      transcriptText: null,
      minutesContent: '',
    });
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('omits action items section when includeActionItems=false', async () => {
    const buf = await renderMeetingMinutesPdf({
      ...baseData,
      includeActionItems: false,
    });
    expect(buf.length).toBeGreaterThan(100);
  });
});

describe('renderMeetingMinutesDocx', () => {
  it('produces a non-empty DOCX buffer (ZIP magic PK)', async () => {
    const buf = await renderMeetingMinutesDocx(baseData);
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('handles empty content without error', async () => {
    const buf = await renderMeetingMinutesDocx({
      ...baseData,
      decisions: [],
      actionItems: [],
      transcriptText: null,
      minutesContent: '',
    });
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});
