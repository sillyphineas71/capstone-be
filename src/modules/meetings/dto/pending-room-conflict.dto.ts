/** Nhóm D (2026-08-08) — cảnh báo mềm: request pending KHÁC đang xin cùng phòng/giờ. */
export class PendingRoomConflictDto {
  meetingTitle: string;
  requesterName: string;
  startTime: Date;
  endTime: Date;
}
