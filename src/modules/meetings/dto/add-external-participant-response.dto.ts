export interface IAddExternalParticipantResponse {
  externalParticipantId: string;
  meetingId: string;
  fullName: string;
  email: string;
  organizationName: string | null;
  phoneNumber: string | null;
  role: string;
  status: string;
}
