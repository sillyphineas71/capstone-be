import { IsUUID } from 'class-validator';

export class RemoveParticipantParamsDto {
  @IsUUID('4')
  meetingId: string;

  @IsUUID('4')
  participantUserId: string;
}
