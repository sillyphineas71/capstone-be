import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

/**
 * PATCH /meeting-minutes/:id/link-resources (UC-141).
 *
 * Mỗi field có 3 trạng thái: vắng mặt (`undefined`, service giữ nguyên giá trị
 * cũ), `null` tường minh (service gỡ liên kết), hoặc UUID hợp lệ (service gán
 * mới). `@ValidateIf` bỏ qua kiểm tra UUID khi giá trị là `null`, để `null`
 * đi qua validation mà không bị `@IsUUID` từ chối.
 */
export class LinkMinutesResourcesDto {
  @IsOptional()
  @ValidateIf((o: LinkMinutesResourcesDto) => o.recordingFileId !== null)
  @IsUUID('4')
  recordingFileId?: string | null;

  @IsOptional()
  @ValidateIf((o: LinkMinutesResourcesDto) => o.transcriptId !== null)
  @IsUUID('4')
  transcriptId?: string | null;
}
