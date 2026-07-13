import { Expose, Type } from 'class-transformer';
import { MeetingMinutesStatus } from '../entities/meeting-minutes.entity.js';
import { UserSummaryDto } from '../../meetings/dto/user-summary.dto.js';
import { MinutesMeetingSummaryDto } from './minutes-meeting-summary.dto.js';

export class MinutesListItemDto {
  @Expose()
  id: string;

  @Expose()
  title: string;

  @Expose()
  status: MeetingMinutesStatus;

  @Expose()
  versionNo: number;

  @Expose()
  createdAt: Date;

  @Expose()
  @Type(() => MinutesMeetingSummaryDto)
  meeting: MinutesMeetingSummaryDto;

  @Expose()
  @Type(() => UserSummaryDto)
  host: UserSummaryDto | null;

  /** true nếu biên bản có nguồn gốc AI (ai_summary_json khác NULL) — badge FE. */
  @Expose()
  isAiGenerated: boolean;

  constructor(
    id: string,
    title: string,
    status: MeetingMinutesStatus,
    versionNo: number,
    createdAt: Date,
    meeting: MinutesMeetingSummaryDto,
    host: UserSummaryDto | null,
    isAiGenerated = false,
  ) {
    this.id = id;
    this.title = title;
    this.status = status;
    this.versionNo = versionNo;
    this.createdAt = createdAt;
    this.meeting = meeting;
    this.host = host;
    this.isAiGenerated = isAiGenerated;
  }
}
