import {
  ImportAccountMode,
  ImportAccountRowStatus,
} from '../constants/import-accounts.constants.js';

/**
 * Kết quả của một dòng trong báo cáo import tài khoản.
 * KHÔNG chứa mật khẩu tạm (NFR-004).
 * Feature: ACCT-IMPORT-ACCOUNT-001
 */
export interface ImportAccountRowResult {
  row: number;
  email: string;
  status: ImportAccountRowStatus;
  reason?: string;
  userId?: string;
}

/**
 * Báo cáo tổng hợp phiên import (preview hoặc commit).
 */
export class ImportAccountReportDto {
  mode: ImportAccountMode;
  totalRows: number;
  validCount?: number;
  invalidCount?: number;
  successCount?: number;
  failedCount?: number;
  results: ImportAccountRowResult[];

  constructor(data: Partial<ImportAccountReportDto>) {
    Object.assign(this, data);
  }
}
