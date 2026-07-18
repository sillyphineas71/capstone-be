import { IsUUID } from 'class-validator';

/**
 * Body cho POST /meeting-minutes/:id/shares (feat-share-meeting-minutes).
 * Cấp quyền xem biên bản cho 1 user nội bộ cụ thể.
 */
export class CreateMinutesShareDto {
  @IsUUID('4', { message: 'userId phải là UUID hợp lệ' })
  userId: string;
}
