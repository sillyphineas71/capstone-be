export class ScheduleRoomDto {
  id: string;
  roomName: string;
  roomCode: string;
  location: string;

  constructor(data: ScheduleRoomDto) {
    this.id = data.id;
    this.roomName = data.roomName;
    this.roomCode = data.roomCode;
    this.location = data.location;
  }
}
