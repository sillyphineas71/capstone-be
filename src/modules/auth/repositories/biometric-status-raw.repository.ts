import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FaceProfileStatusRow } from '../../../common/utils/biometric-status-resolver.util.js';

interface FaceProfileStatusRawRow {
  status: FaceProfileStatusRow['status'];
  last_updated_at: Date | null;
  enrolled_at: Date | null;
}

/**
 * BiometricStatusRawRepository — ACCT-BIOMETRIC-SUBMIT-001 (SB-01 / BR-016).
 *
 * [SỬA 2026-07-29] Đổi tên từ AvatarStatusRawRepository — luồng này là sinh trắc học,
 * không phải avatar hiển thị. Xem
 * spec/features/account/feat-split-avatar-and-biometric/plan.md.
 *
 * Đọc row face_profiles của user bằng parameterized raw SQL theo convention auth module
 * (ADR-001). KHÔNG import AccountsService/FaceProfileService/Repository từ AccountsModule
 * (tránh circular dependency: AccountsModule đã import AuthModule).
 */
@Injectable()
export class BiometricStatusRawRepository {
  constructor(private readonly dataSource: DataSource) {}

  async getFaceProfileRows(userId: string): Promise<FaceProfileStatusRow[]> {
    const rows: FaceProfileStatusRawRow[] = await this.dataSource.query(
      `SELECT status, last_updated_at, enrolled_at
       FROM face_profiles
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );

    return rows.map((row) => ({
      status: row.status,
      lastUpdatedAt: row.last_updated_at ?? null,
      enrolledAt: row.enrolled_at ?? null,
    }));
  }
}
