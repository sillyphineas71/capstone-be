export class RemoveParticipantResponseDto {
  meetingId: string;
  removedParticipantUserId: string;
  removed: boolean;
  removedAt: Date;
  notificationQueued: boolean;
  notificationId: string;
  backgroundJobId: string;

  constructor(data: RemoveParticipantResponseDto) {
    Object.assign(this, data);
  }
}
