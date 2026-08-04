import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from '../entities/user.entity.js';
import { FaceProfileEntity } from '../entities/face-profile.entity.js';
import {
  resolveBiometricReviewStatus,
  FaceProfileStatusRow,
  BiometricReviewStatus,
} from '../../../common/utils/biometric-status-resolver.util.js';
import { isBiometricExemptRole } from '../../../common/utils/biometric-exempt-roles.util.js';
import { getActiveRoleCodes } from '../utils/active-role-codes.util.js';
import { BiometricStatusResponseDto } from '../dto/biometric-status-response.dto.js';

/**
 * BiometricStatusService — ACCT-BIOMETRIC-SUBMIT-001 (US1, FR-001/002/005).
 *
 * [SỬA 2026-07-29] Đổi tên từ AvatarStatusService — luồng này là sinh trắc học, không
 * phải avatar hiển thị. Xem spec/features/account/feat-split-avatar-and-biometric/plan.md.
 *
 * Đọc toàn bộ row face_profiles (chưa soft-delete) của chính user, resolve trạng thái
 * theo BR-004. `users.avatar_url` (chỉ đọc, field `avatarUrl` GIỮ NGUYÊN tên trong response)
 * nay hoàn toàn độc lập với kết quả duyệt sinh trắc học — do feature `feat-update-avatar-photo`
 * quản lý (quyết định D2).
 */
@Injectable()
export class BiometricStatusService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(FaceProfileEntity)
    private readonly faceProfileRepo: Repository<FaceProfileEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async getStatus(userId: string): Promise<BiometricStatusResponseDto> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, avatarUrl: true },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'Không tìm thấy tài khoản.',
      });
    }

    // @DeleteDateColumn → find() tự loại soft-deleted (deleted_at IS NULL).
    const profiles = await this.faceProfileRepo.find({
      where: { userId },
      select: { status: true, lastUpdatedAt: true, enrolledAt: true },
    });

    const rows: FaceProfileStatusRow[] = profiles.map((p) => ({
      status: p.status,
      lastUpdatedAt: p.lastUpdatedAt,
      enrolledAt: p.enrolledAt,
    }));

    const resolution = resolveBiometricReviewStatus(rows);

    // BA 2026-08-03: Business Admin/System Admin không cần sinh trắc học vì
    // không trực tiếp tham dự họp qua FaceGate — miễn trừ 2 cờ, giữ nguyên
    // biometricReviewStatus gốc (không thêm giá trị enum mới).
    const roleCodes = await getActiveRoleCodes(this.dataSource.manager, userId);
    if (isBiometricExemptRole(roleCodes)) {
      return {
        biometricReviewStatus: resolution.biometricReviewStatus,
        avatarUrl: user.avatarUrl,
        biometricRequired: false,
        shouldShowBiometricPopup: false,
        message:
          'Tài khoản Business Admin/System Admin không yêu cầu đăng ký sinh trắc học.',
      };
    }

    return {
      biometricReviewStatus: resolution.biometricReviewStatus,
      avatarUrl: user.avatarUrl,
      biometricRequired: resolution.biometricRequired,
      shouldShowBiometricPopup: resolution.shouldShowBiometricPopup,
      message: this.buildMessage(resolution.biometricReviewStatus, rows),
    };
  }

  /**
   * Build message tiếng Việt theo trạng thái resolve.
   * Với 'rejected': phân biệt reject thật (có row status='rejected') vs
   * disabled/revoked (AC-016/AC-017 yêu cầu wording trung tính, không lộ lý do nội bộ).
   */
  private buildMessage(
    status: BiometricReviewStatus,
    rows: FaceProfileStatusRow[],
  ): string {
    switch (status) {
      case 'not_uploaded':
        return 'Bạn cần cập nhật ảnh sinh trắc học để phục vụ nhận diện khuôn mặt.';
      case 'pending_review':
        return 'Ảnh sinh trắc học của bạn đang chờ quản trị viên duyệt.';
      case 'approved':
        return 'Ảnh sinh trắc học của bạn đã được duyệt.';
      case 'rejected':
        return rows.some((row) => row.status === 'rejected')
          ? 'Ảnh sinh trắc học trước đó đã bị từ chối. Vui lòng nộp lại ảnh khác.'
          : 'Ảnh/hồ sơ khuôn mặt hiện tại không còn hợp lệ. Vui lòng upload lại ảnh khác.';
      default:
        return '';
    }
  }
}
