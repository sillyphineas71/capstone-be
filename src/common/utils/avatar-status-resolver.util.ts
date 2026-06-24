/**
 * ACCT-AVATAR-SUBMIT-001 (BR-004/005/006): Pure function resolve trạng thái avatar
 * của một user từ TOÀN BỘ row face_profiles (chưa soft-delete) của user đó.
 *
 * Dùng chung cho cả module `accounts` (TypeORM Repository) và module `auth`
 * (raw SQL theo ADR-001) — đặt ở `common` để tránh cross-module import / trùng logic.
 *
 * Không phụ thuộc DI/DB: input là danh sách row đã đọc sẵn, không quan tâm nguồn.
 */

export type FaceProfileStatusValue =
  | 'pending_review'
  | 'active'
  | 'rejected'
  | 'disabled'
  | 'revoked';

export type AvatarReviewStatus =
  | 'not_uploaded'
  | 'pending_review'
  | 'rejected'
  | 'approved';

export interface FaceProfileStatusRow {
  status: FaceProfileStatusValue;
  lastUpdatedAt: Date | null;
  enrolledAt: Date | null;
}

export interface AvatarReviewResolution {
  avatarReviewStatus: AvatarReviewStatus;
  avatarRequired: boolean;
  shouldShowAvatarPopup: boolean;
}

/**
 * Thứ tự ưu tiên BẮT BUỘC (BR-004), áp dụng trên toàn bộ row:
 *   1. Có bất kỳ row pending_review  → 'pending_review'
 *   2. Có bất kỳ row active          → 'approved'
 *   3. Còn lại (rejected/disabled/revoked) → 'rejected'
 *   4. Không có row nào              → 'not_uploaded'
 */
export function resolveAvatarReviewStatus(
  rows: FaceProfileStatusRow[],
): AvatarReviewResolution {
  if (rows.some((row) => row.status === 'pending_review')) {
    return buildResolution('pending_review');
  }
  if (rows.some((row) => row.status === 'active')) {
    return buildResolution('approved');
  }
  // Sau khi loại pending_review/active, các row còn lại chỉ có thể là
  // rejected/disabled/revoked — đều map ra 'rejected' (BR-004 bước 3).
  if (rows.length > 0) {
    return buildResolution('rejected');
  }
  return buildResolution('not_uploaded');
}

function buildResolution(
  avatarReviewStatus: AvatarReviewStatus,
): AvatarReviewResolution {
  return {
    avatarReviewStatus,
    // BR-006: chỉ approved mới không yêu cầu avatar.
    avatarRequired: avatarReviewStatus !== 'approved',
    // BR-005: popup chỉ hiện khi not_uploaded hoặc rejected.
    shouldShowAvatarPopup:
      avatarReviewStatus === 'not_uploaded' ||
      avatarReviewStatus === 'rejected',
  };
}
