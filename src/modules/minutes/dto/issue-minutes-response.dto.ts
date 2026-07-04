/**
 * Response DTO for POST /meeting-minutes/:id/issue (UC-MKM-09).
 * Captures the result of publishing a meeting minutes draft to official status.
 */
export class IssueMinutesResponseDto {
  readonly id: string;
  readonly meetingId: string;
  readonly title: string;
  readonly status: string;
  readonly versionNo: number;
  readonly issuedBy: string;
  readonly issuedAt: Date;
  readonly updatedAt: Date;
  readonly notifiedParticipantCount: number;

  constructor(params: {
    id: string;
    meetingId: string;
    title: string;
    status: string;
    versionNo: number;
    issuedBy: string;
    issuedAt: Date;
    updatedAt: Date;
    notifiedParticipantCount: number;
  }) {
    this.id = params.id;
    this.meetingId = params.meetingId;
    this.title = params.title;
    this.status = params.status;
    this.versionNo = params.versionNo;
    this.issuedBy = params.issuedBy;
    this.issuedAt = params.issuedAt;
    this.updatedAt = params.updatedAt;
    this.notifiedParticipantCount = params.notifiedParticipantCount;
  }
}
