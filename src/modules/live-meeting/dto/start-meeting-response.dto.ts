export class StartMeetingResponseDto {
  meetingId: string;
  status: string;
  actualStartTime: string | null;
  alreadyStarted: boolean;
  warningScheduledAt?: string;
  warningSkipped?: boolean;

  constructor(data: StartMeetingResponseDto) {
    Object.assign(this, data);
  }
}
