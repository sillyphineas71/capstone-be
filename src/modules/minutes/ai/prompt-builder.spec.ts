import {
  buildAiMinutesPrompt,
  buildRepairPrompt,
  AI_MINUTES_PROMPT_VERSION,
} from './prompt-builder.js';

describe('prompt-builder (FR-021)', () => {
  it('prompt chinh chua day du chi thi chong bia noi dung', () => {
    const prompt = buildAiMinutesPrompt({
      transcriptText: 'Noi dung transcript mau',
      context: [],
    });
    expect(prompt).toContain('Không xác định');
    expect(prompt).toContain('uncertainParts');
    expect(prompt).toContain('Không tự bịa');
    expect(prompt).toContain('Chỉ sử dụng thông tin có trong transcript');
    expect(prompt).toContain('"summary": "string"'); // schema literal nhúng
    expect(prompt).toContain('Noi dung transcript mau');
    expect(prompt).not.toContain('undefined');
  });

  it('khong co context -> khong render block tai lieu tham khao', () => {
    const prompt = buildAiMinutesPrompt({ transcriptText: 'abc', context: [] });
    expect(prompt).not.toContain('Tài liệu tham khảo bổ sung');
  });

  it('co context (RAG phase sau) -> render block context', () => {
    const prompt = buildAiMinutesPrompt({
      transcriptText: 'abc',
      context: ['doan tai lieu 1'],
    });
    expect(prompt).toContain('Tài liệu tham khảo bổ sung');
    expect(prompt).toContain('doan tai lieu 1');
  });

  it('repair prompt chua error message + output loi + schema (FR-019)', () => {
    const prompt = buildRepairPrompt({
      invalidOutput: '{"sai": true}',
      errorMessage: 'Thieu field bat buoc: "summary"',
    });
    expect(prompt).toContain('Thieu field bat buoc: "summary"');
    expect(prompt).toContain('{"sai": true}');
    expect(prompt).toContain('"summary": "string"');
    expect(prompt).toContain('giữ nguyên nội dung nghiệp vụ');
  });

  it('PROMPT_VERSION la mvp-v2 (DM-04)', () => {
    expect(AI_MINUTES_PROMPT_VERSION).toBe('mvp-v2');
  });

  it('prompt yeu cau do day du (liet ke het decisions/actionItems, summary dai)', () => {
    const prompt = buildAiMinutesPrompt({
      transcriptText: 'Noi dung transcript mau',
      context: [],
    });
    expect(prompt).toContain('KHÔNG được chỉ tóm tắt phần cuối');
    expect(prompt).toContain('liệt kê ĐẦY ĐỦ TẤT CẢ');
  });
});
