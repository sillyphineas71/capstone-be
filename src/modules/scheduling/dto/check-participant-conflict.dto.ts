import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * Input DTO cho POST /api/v1/scheduling/participant-conflicts/check.
 * Kiểm tra xung đột lịch người tham gia nội bộ trong khung giờ chỉ định.
 */
export class CheckParticipantConflictDto {
  @IsNotEmpty({ message: 'startTime là bắt buộc' })
  @IsISO8601(
    { strict: true },
    { message: 'startTime phải đúng định dạng ISO-8601 có timezone' },
  )
  startTime: string;

  @IsNotEmpty({ message: 'endTime là bắt buộc' })
  @IsISO8601(
    { strict: true },
    { message: 'endTime phải đúng định dạng ISO-8601 có timezone' },
  )
  endTime: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'participantUserIds không được để trống' })
  @IsUUID('4', {
    each: true,
    message: 'Mỗi participantUserId phải là UUID hợp lệ',
  })
  @ArrayMaxSize(50, {
    message: 'Số lượng participantUserIds không được vượt quá 50',
  })
  participantUserIds: string[];

  @IsOptional()
  @IsUUID('4', { message: 'excludeMeetingId phải là UUID hợp lệ' })
  excludeMeetingId?: string;

  @IsOptional()
  @IsArray()
  @IsEmail(
    {},
    { each: true, message: 'Mỗi external email phải đúng định dạng email' },
  )
  externalParticipantEmails?: string[];
}
