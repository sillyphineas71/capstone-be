import { MeetingMinutesStatus } from '../entities/meeting-minutes.entity.js';

export class UpdateDraftMinutesResponseDto {
  id: string;
  meetingId: string;
  title: string;
  status: MeetingMinutesStatus;
  versionNo: number;
  minutesContent: string;
  decisionsJson: any;
  actionItemsJson: any;
  attendeesSnapshotJson: any;
  preparedBy: string | null;
  updatedAt: Date;

  constructor(data: Partial<UpdateDraftMinutesResponseDto>) {
    Object.assign(this, data);
  }
}
