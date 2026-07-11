export class DeletionImpactResponseDto {
  roomId: string;
  roomName: string;
  affectedMeetingCount: number;
  blockedByInProgressMeeting: boolean;

  constructor(data: DeletionImpactResponseDto) {
    Object.assign(this, data);
  }
}
