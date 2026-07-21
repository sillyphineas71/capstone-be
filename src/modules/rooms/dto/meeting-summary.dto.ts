import { Expose } from 'class-transformer';

export class MeetingSummaryDto {
  @Expose()
  id: string;

  @Expose()
  title: string;
}
