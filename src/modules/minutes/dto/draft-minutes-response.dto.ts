import {
  MeetingMinutesContentFormat,
  MeetingMinutesStatus,
  MeetingMinutesVisibilityLevel,
} from '../entities/meeting-minutes.entity.js';
import {
  ParticipantRole,
  ParticipantAttendanceStatus,
} from '../../meetings/entities/meeting-participant.entity.js';

export interface MinutesAttendeeSnapshot {
  userId: string;
  participantRole: ParticipantRole;
  attendanceStatus: ParticipantAttendanceStatus;
  joinedAt: Date | null;
  leftAt: Date | null;
}

export interface MeetingSnapshotDto {
  meetingTitle: string;
  actualStartTime: Date | null;
  actualEndTime: Date | null;
  roomId: string | null;
  meetingStatus: string;
  attendees: MinutesAttendeeSnapshot[];
}

export class DraftMinutesResponseDto {
  id: string;
  meetingId: string;
  title: string;
  status: MeetingMinutesStatus;
  visibilityLevel: MeetingMinutesVisibilityLevel;
  versionNo: number;
  contentFormat: MeetingMinutesContentFormat;
  minutesContent: string;
  preparedBy: string;
  createdAt: Date;
  meetingSnapshot: MeetingSnapshotDto;

  constructor(data: DraftMinutesResponseDto) {
    Object.assign(this, data);
  }
}
