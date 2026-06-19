import { NoteResponseDto } from './note-response.dto.js';

describe('NoteResponseDto', () => {
  it('should create dto with all fields', () => {
    const data = {
      id: 'note-1',
      meetingId: 'meeting-1',
      noteType: 'in_meeting',
      content: 'Test content',
      pinned: false,
      visibilityLevel: 'participants',
      author: { id: 'user-1', fullName: 'Nguyen Van A' },
      createdAt: '2026-06-17T09:45:00+07:00',
    };

    const dto = new NoteResponseDto(data);

    expect(dto.id).toBe('note-1');
    expect(dto.meetingId).toBe('meeting-1');
    expect(dto.noteType).toBe('in_meeting');
    expect(dto.content).toBe('Test content');
    expect(dto.pinned).toBe(false);
    expect(dto.visibilityLevel).toBe('participants');
    expect(dto.author).toEqual({ id: 'user-1', fullName: 'Nguyen Van A' });
    expect(dto.createdAt).toBe('2026-06-17T09:45:00+07:00');
  });

  it('should create empty dto with partial data', () => {
    const dto = new NoteResponseDto({ id: 'note-1' });
    expect(dto.id).toBe('note-1');
    expect(dto.meetingId).toBeUndefined();
  });

  it('should have correct field types in nested author', () => {
    const dto = new NoteResponseDto({
      id: 'n1',
      meetingId: 'm1',
      noteType: 'host_note',
      content: 'c',
      pinned: true,
      visibilityLevel: 'private',
      author: { id: 'u1', fullName: 'Host' },
      createdAt: '2026-06-17T10:00:00Z',
    });

    expect(typeof dto.id).toBe('string');
    expect(typeof dto.pinned).toBe('boolean');
    expect(typeof dto.author.id).toBe('string');
    expect(typeof dto.author.fullName).toBe('string');
  });
});
