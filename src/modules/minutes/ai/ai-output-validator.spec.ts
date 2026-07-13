import { validateAiOutput } from './ai-output-validator.js';

const validOutput = () => ({
  summary: 'Tóm tắt cuộc họp',
  keyPoints: ['Ý chính 1'],
  decisions: [
    { text: 'Quyết định A', confidence: 'high', evidence: 'Không xác định' },
  ],
  actionItems: [
    {
      task: 'Việc cần làm',
      owner: 'Không xác định',
      deadline: 'Không xác định',
      confidence: 'medium',
    },
  ],
  risks: ['Rủi ro 1'],
  openQuestions: [],
  uncertainParts: ['Đoạn chưa rõ'],
});

describe('validateAiOutput (NFR-013a — fixtures sai schema)', () => {
  it('output hop le -> ok=true, data day du', () => {
    const result = validateAiOutput(JSON.stringify(validOutput()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.summary).toBe('Tóm tắt cuộc họp');
      expect(result.data.actionItems[0].owner).toBe('Không xác định');
    }
  });

  it('khong parse duoc JSON -> ok=false', () => {
    const result = validateAiOutput('day khong phai JSON {');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('parse');
  });

  it('JSON la mang (khong phai object) -> ok=false', () => {
    const result = validateAiOutput('[1,2,3]');
    expect(result.ok).toBe(false);
  });

  it('thieu field bat buoc (summary) -> ok=false neu ten field trong error', () => {
    const output = validOutput() as Record<string, unknown>;
    delete output.summary;
    const result = validateAiOutput(JSON.stringify(output));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('summary');
  });

  it('confidence ngoai enum -> ok=false', () => {
    const output = validOutput();
    output.decisions[0].confidence = 'very-high';
    const result = validateAiOutput(JSON.stringify(output));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('confidence');
  });

  it('actionItems thieu owner -> ok=false', () => {
    const output = validOutput() as {
      actionItems: Array<Record<string, unknown>>;
    };
    delete output.actionItems[0].owner;
    const result = validateAiOutput(JSON.stringify(output));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('owner');
  });

  it('keyPoints sai type (khong phai mang string) -> ok=false', () => {
    const output = validOutput() as Record<string, unknown>;
    output.keyPoints = 'mot chuoi thay vi mang';
    const result = validateAiOutput(JSON.stringify(output));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('keyPoints');
  });

  it('key la ngoai schema -> ok=false (reject noi dung ngoai schema)', () => {
    const output = validOutput() as Record<string, unknown>;
    output.extraField = 'khong duoc phep';
    const result = validateAiOutput(JSON.stringify(output));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('extraField');
  });

  it('summary rong -> ok=false', () => {
    const output = validOutput();
    output.summary = '   ';
    const result = validateAiOutput(JSON.stringify(output));
    expect(result.ok).toBe(false);
  });
});
