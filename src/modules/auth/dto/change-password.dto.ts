import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for UC-AUTH-04 Change Password endpoint.
 *
 * MaxLength = 72 on all password fields:
 * bcrypt only processes the first 72 bytes of its input (Blowfish cipher limit).
 * Passwords longer than 72 ASCII chars produce the same hash if they share the
 * same first 72 chars — a security vulnerability. Enforcing maxLength=72 also
 * prevents bcrypt-based DoS attacks from extremely long inputs.
 */
export class ChangePasswordDto {
  /**
   * The user's current (existing) password — used to verify identity.
   * No complexity check; just required + max 72 chars (bcrypt limit).
   */
  @ApiProperty({
    description: 'Current password of the authenticated user (used for identity verification)',
    example: 'OldPass@123',
    maxLength: 72,
  })
  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu hiện tại không được để trống' })
  @MaxLength(72, {
    message: 'Mật khẩu hiện tại không được vượt quá 72 ký tự (giới hạn bcrypt)',
  })
  currentPassword: string;

  /**
   * The new password to set.
   * Policy: min 8, max 72 chars, must contain uppercase, lowercase, digit,
   * and at least one special character.
   */
  @ApiProperty({
    description:
      'New password — must be 8–72 chars, include uppercase, lowercase, digit, and special character',
    example: 'NewPass@456',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu mới không được để trống' })
  @MinLength(8, { message: 'Mật khẩu mới phải có ít nhất 8 ký tự' })
  @MaxLength(72, {
    message: 'Mật khẩu mới không được vượt quá 72 ký tự (giới hạn bcrypt)',
  })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&\-_#^()+={}[\]|\\:;<>,.?/`~'"])[A-Za-z\d@$!%*?&\-_#^()+={}[\]|\\:;<>,.?/`~'"]{8,72}$/,
    {
      message:
        'Mật khẩu mới phải chứa ít nhất 1 chữ hoa, 1 chữ thường, 1 chữ số và 1 ký tự đặc biệt',
    },
  )
  newPassword: string;

  /**
   * Confirmation of the new password — must match newPassword exactly.
   * Cross-field match is validated in the service layer (BL-2).
   */
  @ApiProperty({
    description: 'Confirmation of the new password — must match newPassword exactly',
    example: 'NewPass@456',
    maxLength: 72,
  })
  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu xác nhận không được để trống' })
  @MaxLength(72, {
    message: 'Mật khẩu xác nhận không được vượt quá 72 ký tự (giới hạn bcrypt)',
  })
  confirmPassword: string;
}
