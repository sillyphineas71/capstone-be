import { AI_MINUTES_PROMPT_VERSION } from '../constants/ai-minutes-draft.constants.js';

/**
 * MKM-AI-01 — prompt template vi-VN theo Phụ lục A tài liệu định hướng.
 * PROMPT_VERSION (mvp-v1) bump thủ công mỗi khi template đổi (DM-04) — ghi
 * vào ai_summary_json.meta.promptVersion để trace chất lượng output theo prompt.
 * MVP chỉ vi-VN (quyết định 2026-07-07) — không có template en-US.
 */

export interface BuildPromptInput {
  transcriptText: string;
  /** Context bổ sung từ ContextRetrieverPort — MVP luôn rỗng. */
  context: string[];
}

export interface BuildRepairPromptInput {
  invalidOutput: string;
  errorMessage: string;
}

/**
 * JSON Schema tương ứng OUTPUT_SCHEMA_LITERAL — dùng cho Ollama structured
 * output (format: <schema>) thay vì chỉ format: "json". Grammar-constrained
 * decoding đảm bảo model KHÔNG THỂ trả sai cấu trúc (thiếu key, lẫn key giữa
 * decisions/actionItems...) — mạnh hơn nhiều so với chỉ mô tả trong prompt.
 */
export const AI_MINUTES_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    keyPoints: { type: 'array', items: { type: 'string' } },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          evidence: { type: 'string' },
        },
        required: ['text', 'confidence', 'evidence'],
      },
    },
    actionItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          task: { type: 'string' },
          owner: { type: 'string' },
          deadline: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['task', 'owner', 'deadline', 'confidence'],
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
    uncertainParts: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'summary',
    'keyPoints',
    'decisions',
    'actionItems',
    'risks',
    'openQuestions',
    'uncertainParts',
  ],
} as const;

const OUTPUT_SCHEMA_LITERAL = `{
  "summary": "string",
  "keyPoints": ["string"],
  "decisions": [
    {
      "text": "string",
      "confidence": "high | medium | low",
      "evidence": "string | Không xác định"
    }
  ],
  "actionItems": [
    {
      "task": "string",
      "owner": "string | Không xác định",
      "deadline": "string | Không xác định",
      "confidence": "high | medium | low"
    }
  ],
  "risks": ["string"],
  "openQuestions": ["string"],
  "uncertainParts": ["string"]
}`;

export function buildAiMinutesPrompt(input: BuildPromptInput): string {
  const contextBlock =
    input.context.length > 0
      ? `\nTài liệu tham khảo bổ sung:\n${input.context.join('\n---\n')}\n`
      : '';

  return `Bạn là AI tạo biên bản họp nội bộ cho hệ thống SMRMPTS.

Nhiệm vụ:
- Đọc TOÀN BỘ transcript cuộc họp bên dưới, từ đầu tới cuối, kể cả khi transcript
  gồm nhiều phần/nhiều buổi họp nối tiếp nhau (ví dụ: họp tuần này nối với họp
  tuần khác, hoặc buổi bug bash nối với buổi go-live checklist).
- Tạo draft meeting minutes bằng tiếng Việt.
- Chỉ sử dụng thông tin có trong transcript.
- Không tự bịa quyết định, deadline, owner hoặc số liệu.
- Nếu thông tin không rõ, ghi "Không xác định".
- Nếu một phần transcript có khả năng lỗi STT hoặc mơ hồ, đưa vào uncertainParts.
- Trả về JSON đúng schema bên dưới, không markdown, không giải thích ngoài JSON.

Yêu cầu về ĐỘ ĐẦY ĐỦ (BẮT BUỘC — lỗi thường gặp là tóm tắt quá sơ sài so với
transcript dài, PHẢI tránh):
- KHÔNG được chỉ tóm tắt phần cuối hoặc phần nổi bật nhất rồi bỏ qua phần còn lại.
  Nếu transcript có nhiều chủ đề/nhiều buổi họp, "summary" phải lướt qua TỪNG chủ
  đề chính đó, không dồn hết vào 1 câu.
- "summary" phải là một đoạn văn chi tiết, tối thiểu khoảng 150-250 từ (trừ khi
  transcript quá ngắn không đủ nội dung), nêu rõ bối cảnh, các chủ đề đã bàn, và
  kết quả chính của từng chủ đề.
- "decisions" và "actionItems" phải liệt kê ĐẦY ĐỦ TẤT CẢ các quyết định/việc cần
  làm xuất hiện trong transcript (không chỉ 1-2 cái tiêu biểu). Nếu transcript có
  hàng chục quyết định/action item, hãy liệt kê hết, mỗi mục 1 phần tử riêng.
- Nếu người nói tự đính chính lại một thông tin trong lúc họp (ví dụ nói "à khoan,
  để tôi nói lại cho chính xác..."), chỉ lấy giá trị đính chính CUỐI CÙNG, bỏ giá
  trị nháp/sai trước đó — không tạo 2 phần tử trùng lặp cho cùng 1 quyết định.
- "keyPoints" nên liệt kê đủ các ý chính theo từng chủ đề, không giới hạn chỉ 1 ý.

Quy tắc format BẮT BUỘC (nếu sai sẽ bị từ chối):
- Trường "confidence" LUÔN là một trong ba CHUỖI: "high", "medium", "low". TUYỆT ĐỐI không dùng số (không dùng 1, 0.9...).
- Mỗi phần tử trong "decisions" phải đủ 3 khóa: text, confidence, evidence.
- Mỗi phần tử trong "actionItems" phải đủ 4 khóa: task, owner, deadline, confidence. Nếu không có action item nào thì để mảng rỗng [].
- Không thêm bất kỳ khóa nào ngoài schema.

Schema:
${OUTPUT_SCHEMA_LITERAL}

Ví dụ output hợp lệ (transcript ví dụ có nhiều chủ đề — lưu ý output liệt kê đủ
từng quyết định/action item theo từng chủ đề, KHÔNG rút gọn còn 1 mục):
{
  "summary": "Cuộc họp gồm ba phần chính. Phần một về ngân sách, team đã chốt ngân sách trần là 2 tỷ 3 cho toàn dự án. Phần hai về kỹ thuật, dev báo cáo đã fix xong lỗi double charge, ước tính 8 ngày công sau khi phát hiện thêm vấn đề lock database. Phần ba về vận hành, team quyết định dùng Cypress thay vì Playwright cho automation testing vì 2 bạn QA mới đã có kinh nghiệm sẵn với Cypress.",
  "keyPoints": ["Ngân sách trần dự án là 2 tỷ 3", "Lỗi double charge cần 8 ngày công để fix do phát sinh thêm phần lock database", "Chốt dùng Cypress thay vì Playwright cho automation testing"],
  "decisions": [
    {"text": "Ngân sách trần cho dự án là 2 tỷ 3 trăm triệu đồng", "confidence": "high", "evidence": "Không xác định"},
    {"text": "Thời gian fix lỗi double charge là 8 ngày (không phải 6 ngày như báo cáo ban đầu)", "confidence": "high", "evidence": "Không xác định"},
    {"text": "Dùng Cypress thay vì Playwright cho automation testing", "confidence": "high", "evidence": "Không xác định"}
  ],
  "actionItems": [
    {"task": "Fix lỗi double charge bao gồm phần lock database", "owner": "Quân", "deadline": "8 ngày", "confidence": "high"},
    {"task": "Build hàng đợi request cho GHN", "owner": "Hải", "deadline": "4 ngày", "confidence": "high"}
  ],
  "risks": ["Buffer ngân sách còn lại không nhiều nếu phát sinh thêm chi phí"],
  "openQuestions": ["Ai sẽ phụ trách chính việc rà soát log hệ thống"],
  "uncertainParts": []
}
${contextBlock}
Transcript:
"""
${input.transcriptText}
"""`;
}

/**
 * Repair-prompt (FR-019): gửi lại output lỗi + error message + schema, yêu cầu
 * model chỉ sửa FORMAT, không thay đổi nội dung. Tối đa dùng 1 lần/job.
 */
export function buildRepairPrompt(input: BuildRepairPromptInput): string {
  return `Output JSON trước đó của bạn KHÔNG hợp lệ.

Lỗi validation: ${input.errorMessage}

Output không hợp lệ:
"""
${input.invalidOutput}
"""

Yêu cầu:
- Sửa lại cho ĐÚNG schema bên dưới, giữ nguyên nội dung nghiệp vụ.
- Không thêm key ngoài schema, không markdown, không giải thích ngoài JSON.

Schema:
${OUTPUT_SCHEMA_LITERAL}`;
}

export { AI_MINUTES_PROMPT_VERSION };
