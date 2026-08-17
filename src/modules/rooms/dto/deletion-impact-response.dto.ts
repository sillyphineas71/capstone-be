export class DeletionImpactBlockingMeetingDto {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
}

export class DeletionImpactResponseDto {
  roomId: string;
  roomName: string;
  /** true khi khong co cuoc hop nao dang chan (EX1 + EX2) — an toan de goi DELETE. */
  canDelete: boolean;
  blockedByInProgressMeeting: boolean;
  /** Cuoc hop TUONG LAI DA DUYET (status=SCHEDULED) — chan xoa hoan toan (EX2). */
  blockingMeetings: DeletionImpactBlockingMeetingDto[];
  /** Cuoc hop DRAFT/PENDING_APPROVAL — khong chan, se bi null hoa roomId + bao host/manager neu xoa. */
  pendingMeetingCount: number;

  constructor(data: DeletionImpactResponseDto) {
    Object.assign(this, data);
  }
}
