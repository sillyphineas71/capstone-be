/**
 * Dữ liệu đã chuẩn hóa để render biên bản (UC-147). Worker tự trích xuất từ
 * MeetingMinutesEntity + transcript trước khi gọi renderer, giữ renderer thuần
 * (dễ test, không phụ thuộc entity/DB).
 */
export interface MinutesExportData {
  title: string;
  meetingTitle: string | null;
  status: string;
  issuedAt: Date | null;
  generatedAt: Date;
  minutesContent: string;
  /** Danh sách quyết định đã chuẩn hóa thành chuỗi hiển thị. */
  decisions: string[];
  /** Danh sách action item đã chuẩn hóa thành chuỗi hiển thị. */
  actionItems: string[];
  includeActionItems: boolean;
  /** Nội dung transcript (chỉ khi includeTranscript=true và có dữ liệu). */
  transcriptText: string | null;
}

/**
 * Chuẩn hóa 1 mảng JSON (decisions/actionItems — có thể AI-shaped hoặc thủ công)
 * thành mảng chuỗi hiển thị. Trả [] nếu không phải mảng.
 */
export function normalizeMinutesJsonList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        // Decision: {text}; ActionItem: {task, owner, deadline}
        if (typeof o.text === 'string') return o.text;
        if (typeof o.task === 'string') {
          const parts = [o.task];
          if (typeof o.owner === 'string' && o.owner)
            parts.push(`(phụ trách: ${o.owner})`);
          if (typeof o.deadline === 'string' && o.deadline)
            parts.push(`(hạn: ${o.deadline})`);
          return parts.join(' ');
        }
        return JSON.stringify(o);
      }
      return String(item);
    })
    .filter((s) => s.trim().length > 0);
}
