import { Equals } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * ACCT-AVATAR-SUBMIT-001 (BR-011 / VL-01) — body của POST /api/v1/me/avatar-submission.
 *
 * Request là multipart/form-data nên consentAccepted đến dạng string. Transform về boolean
 * trước khi validate: chấp nhận boolean true hoặc string "true"; mọi giá trị khác → reject.
 * File ảnh xử lý riêng qua @UploadedFile (không nằm trong DTO này).
 */
export class SubmitAvatarDto {
  @Transform(({ value }) => value === true || value === 'true')
  @Equals(true, {
    message:
      'Bạn phải đồng ý sử dụng ảnh cho mục đích nhận diện khuôn mặt (consentAccepted).',
  })
  consentAccepted: boolean;
}
