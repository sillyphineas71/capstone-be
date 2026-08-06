import { Expose, Type } from 'class-transformer';
import { UserSummaryDto } from './user-summary.dto.js';
import { RoomSummaryDto } from './room-summary.dto.js';
import { MeetingRequestType } from '../entities/meeting-request.entity.js';

const EDIT_REQUEST_TYPES: readonly MeetingRequestType[] = [
  MeetingRequestType.UPDATE_TIME,
  MeetingRequestType.UPDATE_ROOM,
];

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
  requestedBy: UserSummaryDto;

  @Expose()
  targetRoom: RoomSummaryDto | null;

  @Expose()
  decisionBy: UserSummaryDto | null;

  @Expose()
  meeting: {
    id: string;
    title: string;
    roomId: string | null;
    hostId: string | null;
  } | null;

  /**
   * F-R3 — true nếu đây là yêu cầu CHỈNH SỬA một meeting đã SCHEDULED trước đó
   * (UPDATE_TIME/UPDATE_ROOM), false nếu là yêu cầu đặt phòng MỚI (CREATE_MEETING).
   * Giúp Manager không nhầm 1 request chỉnh sửa với 1 booking mới hoàn toàn.
   */
  @Expose()
  isEditRequest: boolean;

  /** Nhãn hiển thị sẵn cho FE, tính từ requestType — không cần FE tự map enum. */
  @Expose()
  displayLabel: string;

  /**
   * Giá trị TRƯỚC khi đổi (đang giữ trên meeting hiện tại) — CHỈ có khi
   * isEditRequest=true, vì start_time/room_id của meeting chưa từng bị ghi đè
   * lúc đang PENDING_APPROVAL (xem updateMeetingTime/updateMeetingRoom).
   */
  @Expose()
  oldStartTime: Date | null;

  @Expose()
  oldEndTime: Date | null;

  @Expose()
  oldRoomId: string | null;

  /** Giá trị MỚI đang xin đổi — CHỈ có khi isEditRequest=true. */
  @Expose()
  newStartTime: Date | null;

  @Expose()
  newRoomId: string | null;

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
    meeting: {
      id: string;
      title: string;
      roomId: string | null;
      hostId: string | null;
    } | null,
    oldMeetingSnapshot: {
      startTime: Date | null;
      endTime: Date | null;
      roomId: string | null;
    } | null = null,
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

    this.isEditRequest = EDIT_REQUEST_TYPES.includes(
      requestType as MeetingRequestType,
    );
    this.displayLabel = this.isEditRequest
      ? 'Yêu cầu chỉnh sửa'
      : 'Yêu cầu đặt phòng mới';

    if (this.isEditRequest && oldMeetingSnapshot) {
      this.oldStartTime = oldMeetingSnapshot.startTime;
      this.oldEndTime = oldMeetingSnapshot.endTime;
      this.oldRoomId = oldMeetingSnapshot.roomId;
      this.newStartTime = requestedStartTime;
      this.newRoomId = targetRoom?.id ?? null;
    } else {
      this.oldStartTime = null;
      this.oldEndTime = null;
      this.oldRoomId = null;
      this.newStartTime = null;
      this.newRoomId = null;
    }
  }
}
