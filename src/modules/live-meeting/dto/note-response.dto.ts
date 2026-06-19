/**
 * DTO cho response cua UC-102/103/104.
 * Pattern theo StartMeetingResponseDto / EndMeetingResponseDto.
 */
export class NoteResponseDto {
  id: string;
  meetingId: string;
  noteType: string;
  content: string;
  pinned: boolean;
  visibilityLevel: string;
  author: { id: string; fullName: string };
  createdAt: string;

  constructor(data: Partial<NoteResponseDto>) {
    Object.assign(this, data);
  }
}
