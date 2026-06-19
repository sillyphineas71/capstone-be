/**
 * DTO cho response UC-IMM-10 View Meeting Notes.
 * noteTimestamp (map tu created_at) thay vi createdAt (CD-001).
 * sourceEventTime / sourceEventType chi xuat hien khi includeSourceEvent=true.
 */
export class ViewNoteResponseDto {
  id: string;
  meetingId: string;
  noteType: string;
  content: string;
  pinned: boolean;
  visibilityLevel: string;
  author: { id: string; fullName: string };
  sourceEventId: string | null;
  noteTimestamp: string;
  updatedAt: string;

  // Chi xuat hien khi includeSourceEvent=true:
  sourceEventTime?: string | null;
  sourceEventType?: string | null;

  constructor(data: Partial<ViewNoteResponseDto>) {
    Object.assign(this, data);
  }
}
