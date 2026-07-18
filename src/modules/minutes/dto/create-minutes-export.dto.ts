import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export type MinutesExportFormat = 'pdf' | 'docx';

/**
 * Body cho POST /meeting-minutes/:id/exports (UC-147).
 * Tạo job bất đồng bộ xuất biên bản ra PDF hoặc Word.
 */
export class CreateMinutesExportDto {
  @IsIn(['pdf', 'docx'], { message: "format chỉ chấp nhận 'pdf' hoặc 'docx'" })
  format: MinutesExportFormat;

  @IsOptional()
  @IsBoolean({ message: 'includeTranscript phải là boolean' })
  includeTranscript?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'includeActionItems phải là boolean' })
  includeActionItems?: boolean;
}
