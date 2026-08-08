import {
  IsIn,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  MaxLength,
} from 'class-validator';

/**
 * DTO cho UC-102 Tao ghi chu trong cuoc hop.
 * Cho phep system_note qua DTO validate (khong bi 400) de xuong Service bat 422.
 */
export class CreateNoteDto {
  @IsIn(['in_meeting', 'private', 'host_note', 'system_note'])
  noteType: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsIn(['private', 'participants', 'department', 'public_internal', 'guest_shared'])
  visibilityLevel?: string;
}
