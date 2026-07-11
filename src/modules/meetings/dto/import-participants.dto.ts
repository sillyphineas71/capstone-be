import { IsOptional, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO cho request import thành viên bằng Excel.
 * File nhận qua @UploadedFile(); DTO chỉ chứa cờ điều khiển.
 * Feature: MEET-IMPORT-PARTICIPANT-001
 */
export class ImportParticipantsDto {
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean({ message: 'forceAddWithWarnings phải là boolean' })
  forceAddWithWarnings?: boolean;
}
