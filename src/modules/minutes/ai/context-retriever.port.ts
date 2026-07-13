import { Injectable } from '@nestjs/common';

/**
 * MKM-AI-01 — ContextRetrieverPort: điểm mở rộng cho RAG phase sau
 * (feat-rag-meeting-attachment-context). MVP luôn trả context rỗng —
 * KHÔNG implement retrieval/embedding/vector search trong feature này
 * (OOS-001, theo Phụ lục B tài liệu định hướng).
 */
export interface ContextRetrieverPort {
  /** Trả các đoạn context bổ sung cho prompt (MVP: luôn []). */
  retrieve(meetingId: string): Promise<string[]>;
}

export const CONTEXT_RETRIEVER = Symbol('CONTEXT_RETRIEVER');

@Injectable()
export class EmptyContextRetriever implements ContextRetrieverPort {
  retrieve(): Promise<string[]> {
    // MVP: bo qua meetingId — luon tra rong
    return Promise.resolve([]);
  }
}
