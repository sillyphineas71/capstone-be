import { Expose, Type } from 'class-transformer';
import { UserSummaryDto } from './user-summary.dto.js';
import { RoomSummaryDto } from './room-summary.dto.js';

export class MeetingRequestListItemDto {
  @Expose()
  id: string;

  @Expose()
  requestCode: string;

  @Expose()
  requestType: string;

  @Expose()
  approvalStatus: string;

  @Expose()
  requestedAt: Date;

  @Expose()
  requestedStartTime: Date | null;

  @Expose()
  requestedEndTime: Date | null;

  @Expose()
  conflictCheckStatus: string;

  @Expose()
  conflictSummary: Record<string, unknown> | null;

  @Expose()
  decisionAt: Date | null;

  @Expose()
  rejectionReason: string | null;

  @Expose()
  @Type(() => UserSummaryDto)
  requestedBy: UserSummaryDto;

  @Expose()
  @Type(() => RoomSummaryDto)
  targetRoom: RoomSummaryDto | null;

  @Expose()
  @Type(() => UserSummaryDto)
  decisionBy: UserSummaryDto | null;

  @Expose()
  meeting: { id: string; title: string } | null;

  constructor(
    id: string,
    requestCode: string,
    requestType: string,
    approvalStatus: string,
    requestedAt: Date,
    requestedStartTime: Date | null,
    requestedEndTime: Date | null,
    conflictCheckStatus: string,
    conflictSummary: Record<string, unknown> | null,
    decisionAt: Date | null,
    rejectionReason: string | null,
    requestedBy: UserSummaryDto,
    targetRoom: RoomSummaryDto | null,
    decisionBy: UserSummaryDto | null,
    meeting: { id: string; title: string } | null,
  ) {
    this.id = id;
    this.requestCode = requestCode;
    this.requestType = requestType;
    this.approvalStatus = approvalStatus;
    this.requestedAt = requestedAt;
    this.requestedStartTime = requestedStartTime;
    this.requestedEndTime = requestedEndTime;
    this.conflictCheckStatus = conflictCheckStatus;
    this.conflictSummary = conflictSummary;
    this.decisionAt = decisionAt;
    this.rejectionReason = rejectionReason;
    this.requestedBy = requestedBy;
    this.targetRoom = targetRoom;
    this.decisionBy = decisionBy;
    this.meeting = meeting;
  }
}
