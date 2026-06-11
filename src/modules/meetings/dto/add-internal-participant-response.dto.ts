export interface IAddInternalParticipantResponse {
  participantId: string;
  meetingId: string;
  userId: string;
  role: string;
  status: string;
}

export class AddInternalParticipantResponseDto {
  participantId: string;
  meetingId: string;
  userId: string;
  role: string;
  status: string;

  constructor(data: AddInternalParticipantResponseDto) {
    Object.assign(this, data);
  }
}
