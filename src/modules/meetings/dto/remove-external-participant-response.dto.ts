export class RemoveExternalParticipantResponseDto {
  meetingId: string;
  removedExternalParticipantId: string;
  removed: boolean;
  removedAt: Date;
  notificationQueued: boolean;
  notificationId: string | null;
  backgroundJobId: string | null;

  constructor(data: {
    meetingId: string;
    removedExternalParticipantId: string;
    removed: boolean;
    removedAt: Date;
    notificationQueued: boolean;
    notificationId: string | null;
    backgroundJobId: string | null;
  }) {
    this.meetingId = data.meetingId;
    this.removedExternalParticipantId = data.removedExternalParticipantId;
    this.removed = data.removed;
    this.removedAt = data.removedAt;
    this.notificationQueued = data.notificationQueued;
    this.notificationId = data.notificationId;
    this.backgroundJobId = data.backgroundJobId;
  }
}
