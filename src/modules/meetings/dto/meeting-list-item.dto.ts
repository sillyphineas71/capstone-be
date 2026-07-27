import { ApiProperty } from '@nestjs/swagger';

// BE-02 (2026-07-26): field tra ve cho GET /meetings (list, admin).
// KHONG include cancellationReason/description day du hay bat ky field
// lien quan noi dung nhay cam khac — day la man LIST tong quan, khong phai detail.
export class MeetingListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  meetingCode: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  meetingType: string;

  @ApiProperty()
  meetingMode: string;

  @ApiProperty()
  startTime: Date;

  @ApiProperty()
  endTime: Date;

  @ApiProperty({ nullable: true })
  roomId: string | null;

  @ApiProperty({ nullable: true })
  roomName: string | null;

  @ApiProperty()
  organizerId: string;

  @ApiProperty({ nullable: true })
  organizerName: string | null;

  @ApiProperty()
  createdAt: Date;

  constructor(partial: MeetingListItemDto) {
    Object.assign(this, partial);
  }
}
