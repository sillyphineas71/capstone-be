import { StartMeetingResponseDto } from './start-meeting-response.dto.js';

describe('StartMeetingResponseDto', () => {
  it('should create DTO with all fields', () => {
    const now = new Date().toISOString();
    const dto = new StartMeetingResponseDto({
      meetingId: 'm-001',
      status: 'in_progress',
      actualStartTime: now,
      alreadyStarted: false,
    });

    expect(dto.meetingId).toBe('m-001');
    expect(dto.status).toBe('in_progress');
    expect(dto.actualStartTime).toBe(now);
    expect(dto.alreadyStarted).toBe(false);
  });

  it('should allow null actualStartTime', () => {
    const dto = new StartMeetingResponseDto({
      meetingId: 'm-001',
      status: 'scheduled',
      actualStartTime: null,
      alreadyStarted: false,
    });

    expect(dto.actualStartTime).toBeNull();
  });

  it('should handle alreadyStarted = true', () => {
    const dto = new StartMeetingResponseDto({
      meetingId: 'm-001',
      status: 'in_progress',
      actualStartTime: new Date().toISOString(),
      alreadyStarted: true,
    });

    expect(dto.alreadyStarted).toBe(true);
  });
});
