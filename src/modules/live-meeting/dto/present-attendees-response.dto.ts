import {
  PresentAttendeeItem,
  PresenceStatus,
} from '../types/present-attendee.type.js';

export class PresentAttendeesResponseDto {
  meetingId: string;
  occupancyCount: number;
  presentUsers: PresentAttendeeItem[];
  updatedAt: string;

  constructor(data: PresentAttendeesResponseDto) {
    Object.assign(this, data);
  }
}

export { PresenceStatus };
export type { PresentAttendeeItem };
