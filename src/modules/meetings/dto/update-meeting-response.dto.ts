export class UpdateMeetingResponseDto {
  meetingId: string;
  title: string;
  description: string | null;
  updatedAt: Date;

  constructor(data: UpdateMeetingResponseDto) {
    Object.assign(this, data);
  }
}
