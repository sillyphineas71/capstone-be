import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  MaxLength,
} from 'class-validator';
import { Expose } from 'class-transformer';

/** UC8 (VCL-001): 2 loại danh sách kiểm soát phương tiện — bất biến sau khi tạo (spec §1.2). */
export const CONTROL_LIST_TYPES = ['blocklist', 'watchlist'] as const;
export type ControlListType = (typeof CONTROL_LIST_TYPES)[number];

/**
 * CreateVehicleControlListDto (VCL-001 / UC8) — body POST /anpr/admin/control-list.
 *
 * KHÔNG có `active`/`created_by`: `active` mặc định `true` ở service, `created_by` lấy
 * từ JWT (@CurrentUser), KHÔNG từ body — mirror SEC-01/02 của UC1.
 */
export class CreateVehicleControlListDto {
  @ApiProperty({
    description: 'Biển số xe dạng thô (chưa chuẩn hoá)',
    maxLength: 20,
  })
  @Expose({ name: 'plate_raw' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  plateRaw: string;

  @ApiProperty({
    description: 'Phân loại danh sách kiểm soát — bất biến sau khi tạo',
    enum: CONTROL_LIST_TYPES,
  })
  @Expose({ name: 'list_type' })
  @IsIn(CONTROL_LIST_TYPES)
  listType: ControlListType;

  @ApiPropertyOptional({
    description: 'Lý do đưa vào danh sách kiểm soát',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
