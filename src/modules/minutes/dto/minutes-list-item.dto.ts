import { Expose, Type } from 'class-transformer';
import {
  MeetingMinutesStatus,
  MeetingMinutesSource,
} from '../entities/meeting-minutes.entity.js';
import { UserSummaryDto } from '../../meetings/dto/user-summary.dto.js';
import { MinutesMeetingSummaryDto } from './minutes-meeting-summary.dto.js';
import { UserProfileSummaryDto } from './user-profile-summary.dto.js';

export class MinutesListItemDto {
  @Expose()
  id: string;

  @Expose()
  title: string;

  @Expose()
  status: MeetingMinutesStatus;

  @Expose()
  versionNo: number;

  /** MKM-MANUAL-01: 'ai' | 'manual' */
  @Expose()
  source: MeetingMinutesSource;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  /** null nếu biên bản chưa được ban hành (draft). */
  @Expose()
  issuedAt: Date | null;

  @Expose()
  @Type(() => MinutesMeetingSummaryDto)
  meeting: MinutesMeetingSummaryDto;

  @Expose()
  @Type(() => UserSummaryDto)
  host: UserSummaryDto | null;

  /** null nếu biên bản ở trạng thái draft (chưa ban hành). */
  @Expose()
  @Type(() => UserProfileSummaryDto)
  issuedBy: UserProfileSummaryDto | null;

  @Expose()
  @Type(() => UserProfileSummaryDto)
  preparedBy: UserProfileSummaryDto | null;

  /** true nếu biên bản có nguồn gốc AI (ai_summary_json khác NULL) — badge FE. */
  @Expose()
  isAiGenerated: boolean;

  constructor(data: MinutesListItemDto) {
    Object.assign(this, data);
  }
}
