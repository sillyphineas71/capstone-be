import { IsUUID } from 'class-validator';

export class RemoveExternalParticipantParamsDto {
  @IsUUID('4', { message: 'meetingId phải là định dạng UUID' })
  meetingId: string;

  @IsUUID('4', { message: 'externalParticipantId phải là định dạng UUID' })
  externalParticipantId: string;
}
