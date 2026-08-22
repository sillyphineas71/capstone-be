export class DeleteRoomResponseDto {
  roomId: string;
  deletedAt: Date;
  affectedMeetingCount: number;
  /** So thiet bi bi TU DONG GO khoi phong nay (ve trang thai available) do phong bi xoa. */
  affectedEquipmentCount: number;
  notificationJobId: string | null;

  constructor(data: DeleteRoomResponseDto) {
    Object.assign(this, data);
  }
}
