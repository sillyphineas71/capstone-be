// MinutesDetailResponseDto — response for GET meeting-minutes/:id (UC-MKM-03)
// Nested DTOs for 4 data groups: generalInfo, mainContent, relatedResources, attachments

import { MeetingMinutesStatus } from '../entities/meeting-minutes.entity.js';
import {
  MinutesActionItem,
  MinutesDecisionItem,
} from './minutes-content.dto.js';

/* ── Nested DTOs ── */

export class MinutesAttendeeDto {
  userId: string;
  fullName: string;
  email: string;
  participantRole: string;
  attendanceStatus: string;
  joinedAt: Date | null;
  leftAt: Date | null;

  constructor(data: MinutesAttendeeDto) {
    Object.assign(this, data);
  }
}

export class RoomDetailDto {
  id: string;
  roomName: string;
  siteName: string | null;
  areaName: string | null;
  locationDescription: string | null;

  constructor(data: RoomDetailDto) {
    Object.assign(this, data);
  }
}

export class MinutesGeneralInfoDto {
  meetingTitle: string;
  actualStartTime: Date | null;
  actualEndTime: Date | null;
  meetingMode: string;
  room: RoomDetailDto | null;
  host: { id: string; fullName: string; email: string } | null;
  noteTaker: { id: string; fullName: string; email: string } | null;
  attendees: MinutesAttendeeDto[];

  constructor(data: MinutesGeneralInfoDto) {
    Object.assign(this, data);
  }
}

export class MinutesMainContentDto {
  minutesContent: string;
  decisions: MinutesDecisionItem[] | null;
  actionItems: MinutesActionItem[] | null;

  constructor(data: MinutesMainContentDto) {
    Object.assign(this, data);
  }
}

/**
 * Khối insight do AI sinh — chỉ có giá trị khi biên bản có nguồn gốc AI
 * (aiSummaryJson khác NULL). `meta` là read-only (provider/model/generatedAt).
 */
export class MinutesAiSummaryDto {
  keyPoints: string[];
  risks: string[];
  openQuestions: string[];
  uncertainParts: string[];
  meta: Record<string, unknown> | null;

  constructor(data: MinutesAiSummaryDto) {
    Object.assign(this, data);
  }
}

export class TranscriptSummaryDto {
  id: string;
  status: string;
  versionNo: number;
  languageCode: string | null;

  constructor(data: TranscriptSummaryDto) {
    Object.assign(this, data);
  }
}

export class RecordingSummaryDto {
  id: string;
  fileName: string;
  durationSeconds: number | null;
  mimeType: string;

  constructor(data: RecordingSummaryDto) {
    Object.assign(this, data);
  }
}

export class MinutesRelatedResourcesDto {
  transcript: TranscriptSummaryDto | null;
  recording: RecordingSummaryDto | null;

  constructor(data: MinutesRelatedResourcesDto) {
    Object.assign(this, data);
  }
}

export class MinutesAttachmentSummaryDto {
  id: string;
  fileName: string;
  fileType: string;
  mimeType: string;
  fileSizeBytes: string | null;
  uploadedBy: string | null;
  uploadedAt: Date;

  constructor(data: MinutesAttachmentSummaryDto) {
    Object.assign(this, data);
  }
}

export class MinutesPermissionsDto {
  canEdit: boolean;
  canIssue: boolean;

  constructor(canEdit: boolean, canIssue: boolean) {
    this.canEdit = canEdit;
    this.canIssue = canIssue;
  }
}

/* ── Root DTO ── */

export class MinutesDetailResponseDto {
  id: string;
  meetingId: string;
  title: string;
  status: MeetingMinutesStatus;
  versionNo: number;
  generalInfo: MinutesGeneralInfoDto;
  mainContent: MinutesMainContentDto;
  /** Khối insight AI (null nếu biên bản soạn tay). */
  aiSummary: MinutesAiSummaryDto | null;
  /** true nếu biên bản có nguồn gốc AI (aiSummaryJson khác NULL). */
  isAiGenerated: boolean;
  relatedResources: MinutesRelatedResourcesDto;
  attachments: MinutesAttachmentSummaryDto[];
  preparedBy: { id: string; fullName: string; email: string } | null;
  issuedBy: { id: string; fullName: string; email: string } | null;
  issuedAt: Date | null;
  approvedBy: { id: string; fullName: string; email: string } | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  permissions: MinutesPermissionsDto;

  constructor(data: MinutesDetailResponseDto) {
    Object.assign(this, data);
  }
}
