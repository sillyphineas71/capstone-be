import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * feat-split-avatar-and-biometric (T01): đổi tên permission code cho đúng bản chất
 * "sinh trắc học/biometric" (bắt buộc + phải duyệt cho FaceGate) — trước đây bị
 * gọi nhầm "avatar". Dùng UPDATE (không phải insert-mới + xoá-cũ) để giữ nguyên
 * `id` và toàn bộ liên kết `role_permissions` hiện có, không cần seed lại role.
 *
 * Xem spec/features/account/feat-split-avatar-and-biometric/plan.md §3.1.
 */
export class RenameAvatarPermissionsToBiometric20260729000001 implements MigrationInterface {
  name = 'RenameAvatarPermissionsToBiometric20260729000001';

  private readonly renames: Array<{
    from: string;
    to: string;
    name: string;
  }> = [
    {
      from: 'profile.avatar.read_status',
      to: 'profile.biometric.read_status',
      name: 'Xem trạng thái sinh trắc học của chính mình',
    },
    {
      from: 'profile.avatar.submit',
      to: 'profile.biometric.submit',
      name: 'Tự nộp/nộp lại ảnh sinh trắc học của chính mình',
    },
    {
      from: 'account.avatar.review',
      to: 'account.biometric.review',
      name: 'Xem và duyệt/từ chối ảnh sinh trắc học',
    },
    {
      from: 'account.avatar.download',
      to: 'account.biometric.download',
      name: 'Tải ảnh sinh trắc học submission',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const rename of this.renames) {
      await queryRunner.query(
        `UPDATE permissions
            SET permission_code = $1, permission_name = $2
          WHERE permission_code = $3;`,
        [rename.to, rename.name, rename.from],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const rename of this.renames) {
      await queryRunner.query(
        `UPDATE permissions
            SET permission_code = $1
          WHERE permission_code = $2;`,
        [rename.from, rename.to],
      );
    }
  }
}
