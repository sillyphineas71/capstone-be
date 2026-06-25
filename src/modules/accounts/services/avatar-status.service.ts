import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../entities/user.entity.js';
import { FaceProfileEntity } from '../entities/face-profile.entity.js';
import {
  resolveAvatarReviewStatus,
  FaceProfileStatusRow,
  AvatarReviewStatus,
} from '../../../common/utils/avatar-status-resolver.util.js';
import { AvatarStatusResponseDto } from '../dto/avatar-status-response.dto.js';

/**
 * AvatarStatusService — ACCT-AVATAR-SUBMIT-001 (US1, FR-001/002/005).
 *
 * Đọc toàn bộ row face_profiles (chưa soft-delete) của chính user, resolve trạng thái
 * theo BR-004, kết hợp users.avatar_url (chỉ đọc), build message phù hợp.
 */
@Injectable()
export class AvatarStatusService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(FaceProfileEntity)
    private readonly faceProfileRepo: Repository<FaceProfileEntity>,
  ) {}

  async getStatus(userId: string): Promise<AvatarStatusResponseDto> {
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

    const resolution = resolveAvatarReviewStatus(rows);

    return {
      avatarReviewStatus: resolution.avatarReviewStatus,
      avatarUrl: user.avatarUrl,
      avatarRequired: resolution.avatarRequired,
      shouldShowAvatarPopup: resolution.shouldShowAvatarPopup,
      message: this.buildMessage(resolution.avatarReviewStatus, rows),
    };
  }

  /**
   * Build message tiếng Việt theo trạng thái resolve.
   * Với 'rejected': phân biệt reject thật (có row status='rejected') vs
   * disabled/revoked (AC-016/AC-017 yêu cầu wording trung tính, không lộ lý do nội bộ).
   */
  private buildMessage(
    status: AvatarReviewStatus,
    rows: FaceProfileStatusRow[],
  ): string {
    switch (status) {
      case 'not_uploaded':
        return 'Bạn cần cập nhật ảnh đại diện để phục vụ nhận diện khuôn mặt.';
      case 'pending_review':
        return 'Ảnh đại diện của bạn đang chờ quản trị viên duyệt.';
      case 'approved':
        return 'Ảnh đại diện của bạn đã được duyệt.';
      case 'rejected':
        return rows.some((row) => row.status === 'rejected')
          ? 'Ảnh đại diện trước đó đã bị từ chối. Vui lòng nộp lại ảnh khác.'
          : 'Ảnh/hồ sơ khuôn mặt hiện tại không còn hợp lệ. Vui lòng upload lại ảnh khác.';
      default:
        return '';
    }
  }
}
