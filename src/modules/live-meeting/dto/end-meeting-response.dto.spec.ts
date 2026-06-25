import { EndMeetingResponseDto } from './end-meeting-response.dto.js';

describe('EndMeetingResponseDto', () => {
  it('should create DTO with all fields', () => {
    const now = new Date().toISOString();
    const dto = new EndMeetingResponseDto({
      meetingId: 'm-001',
      status: 'completed',
      actualEndTime: now,
      duration: 85,
      roomReleased: true,
    });

    expect(dto.meetingId).toBe('m-001');
    expect(dto.status).toBe('completed');
    expect(dto.actualEndTime).toBe(now);
    expect(dto.duration).toBe(85);
    expect(dto.roomReleased).toBe(true);
  });

  it('should handle roomReleased = false', () => {
    const dto = new EndMeetingResponseDto({
      meetingId: 'm-001',
      status: 'completed',
      actualEndTime: new Date().toISOString(),
      duration: 120,
      roomReleased: false,
    });

    expect(dto.roomReleased).toBe(false);
    expect(dto.duration).toBe(120);
  });

  it('should handle zero duration', () => {
    const dto = new EndMeetingResponseDto({
      meetingId: 'm-001',
      status: 'completed',
      actualEndTime: new Date().toISOString(),
      duration: 0,
      roomReleased: false,
    });

    expect(dto.duration).toBe(0);
  });
});
