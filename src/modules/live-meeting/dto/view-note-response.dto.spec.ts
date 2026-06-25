import { ViewNoteResponseDto } from './view-note-response.dto.js';

describe('ViewNoteResponseDto', () => {
  it('should create dto with all required fields', () => {
    const data = {
      id: 'note-1',
      meetingId: 'meeting-1',
      noteType: 'in_meeting',
      content: 'Test content',
      pinned: false,
      visibilityLevel: 'participants',
      author: { id: 'user-1', fullName: 'Nguyen Van A' },
      sourceEventId: null,
      noteTimestamp: '2026-06-18T09:45:00+07:00',
      updatedAt: '2026-06-18T09:45:00+07:00',
    };
    const dto = new ViewNoteResponseDto(data);
    expect(dto.id).toBe('note-1');
    expect(dto.noteTimestamp).toBe('2026-06-18T09:45:00+07:00');
    expect((dto as any).createdAt).toBeUndefined();
    expect(dto.sourceEventTime).toBeUndefined();
    expect(dto.sourceEventType).toBeUndefined();
  });

  it('should include sourceEventTime/sourceEventType when enriched', () => {
    const data = {
      id: 'note-1',
      meetingId: 'meeting-1',
      noteType: 'in_meeting',
      content: 'Test',
      pinned: false,
      visibilityLevel: 'participants',
      author: { id: 'user-1', fullName: 'Nguyen Van A' },
      sourceEventId: 'evt-1',
      sourceEventTime: '2026-06-18T09:43:00+07:00',
      sourceEventType: 'meeting_started',
      noteTimestamp: '2026-06-18T09:45:00+07:00',
      updatedAt: '2026-06-18T09:45:00+07:00',
    };
    const dto = new ViewNoteResponseDto(data);
    expect(dto.sourceEventTime).toBe('2026-06-18T09:43:00+07:00');
    expect(dto.sourceEventType).toBe('meeting_started');
  });

  it('should have null sourceEventTime/sourceEventType when event not found', () => {
    const data = {
      id: 'note-1',
      meetingId: 'meeting-1',
      noteType: 'in_meeting',
      content: 'Test',
      pinned: false,
      visibilityLevel: 'participants',
      author: { id: 'user-1', fullName: 'Nguyen Van A' },
      sourceEventId: 'evt-missing',
      sourceEventTime: null,
      sourceEventType: null,
      noteTimestamp: '2026-06-18T09:45:00+07:00',
      updatedAt: '2026-06-18T09:45:00+07:00',
    };
    const dto = new ViewNoteResponseDto(data);
    expect(dto.sourceEventTime).toBeNull();
    expect(dto.sourceEventType).toBeNull();
  });

  it('should have nested author.id and author.fullName', () => {
    const data = {
      id: 'note-1',
      meetingId: 'meeting-1',
      noteType: 'in_meeting',
      content: 'Test',
      pinned: false,
      visibilityLevel: 'participants',
      author: { id: 'user-1', fullName: 'Nguyen Van A' },
      sourceEventId: null,
      noteTimestamp: '2026-06-18T09:45:00+07:00',
      updatedAt: '2026-06-18T09:45:00+07:00',
    };
    const dto = new ViewNoteResponseDto(data);
    expect(dto.author.id).toBe('user-1');
    expect(dto.author.fullName).toBe('Nguyen Van A');
  });
});
