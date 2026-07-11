import {
  ImportRowStatus,
  ImportParticipantType,
} from '../constants/import-participants.constants.js';

/**
 * Kết quả của một dòng trong báo cáo import thành viên.
 * Feature: MEET-IMPORT-PARTICIPANT-001
 */
export interface ImportRowResult {
  row: number;
  type: ImportParticipantType | 'unknown';
  identifier: string;
  status: ImportRowStatus;
  reason?: string;
  participantId?: string;
}

/**
 * Báo cáo tổng hợp phiên import (preview hoặc commit).
 */
export class ImportParticipantsReportDto {
  totalRows: number;
  successCount: number;
  failedCount: number;
  warningCount: number;
  results: ImportRowResult[];

  constructor(data: Partial<ImportParticipantsReportDto>) {
    Object.assign(this, data);
  }
}
