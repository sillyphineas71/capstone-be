import { Injectable } from '@nestjs/common';
import { LlmProviderPort } from './llm-provider.port.js';

/**
 * MKM-AI-01 — MockLlmProvider (FR-015): trả JSON mẫu hợp lệ theo schema
 * spec 5.3, cho phép chạy end-to-end (queue → worker → validate → DB)
 * không cần GPU/Ollama. Là provider mặc định của seed config (provider=mock).
 */
@Injectable()
export class MockLlmProvider implements LlmProviderPort {
  generate(): Promise<string> {
    const sample = {
      summary:
        'Cuộc họp thảo luận tiến độ dự án và phân công công việc cho tuần tới. ' +
        '(Bản nháp sinh bởi MockLlmProvider — dùng cho dev/test, không phải nội dung thật.)',
      keyPoints: [
        'Tiến độ tổng thể đạt kế hoạch đề ra',
        'Cần bổ sung tài liệu hướng dẫn trước buổi review tiếp theo',
      ],
      decisions: [
        {
          text: 'Chốt phương án triển khai theo đề xuất đã trình bày',
          confidence: 'medium',
          evidence: 'Không xác định',
        },
      ],
      actionItems: [
        {
          task: 'Chuẩn bị tài liệu hướng dẫn sử dụng',
          owner: 'Không xác định',
          deadline: 'Không xác định',
          confidence: 'medium',
        },
      ],
      risks: ['Tiến độ có thể chậm nếu thiếu nhân sự review'],
      openQuestions: ['Thời điểm demo chính thức chưa được chốt'],
      uncertainParts: [
        'Một số đoạn transcript không rõ người nói (diarization đang tắt)',
      ],
    };
    return Promise.resolve(JSON.stringify(sample));
  }
}
