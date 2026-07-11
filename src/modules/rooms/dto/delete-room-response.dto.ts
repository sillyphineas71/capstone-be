export class DeleteRoomResponseDto {
  roomId: string;
  deletedAt: Date;
  affectedMeetingCount: number;
  notificationJobId: string | null;

  constructor(data: DeleteRoomResponseDto) {
    Object.assign(this, data);
  }
}
