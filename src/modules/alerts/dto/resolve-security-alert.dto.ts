import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { Expose } from 'class-transformer';

/**
 * ResolveSecurityAlertDto (ASC-001 / UC-123) — body POST
 * /api/v1/security-alerts/:id/resolve. `resolutionNote` BẮT BUỘC (khác `acknowledge`,
 * không cần note) — đúng ý nghĩa cột `resolution_note` gắn với bước ĐÓNG cảnh báo.
 */
export class ResolveSecurityAlertDto {
  @ApiProperty({
    description: 'Ghi chú xử lý khi đóng cảnh báo (bắt buộc)',
    maxLength: 1000,
  })
  @Expose({ name: 'resolution_note' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  resolutionNote: string;
}
