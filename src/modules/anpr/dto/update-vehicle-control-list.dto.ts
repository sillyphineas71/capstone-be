import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

/**
 * UpdateVehicleControlListDto (VCL-001 / UC8) — body PATCH /anpr/admin/control-list/:id.
 *
 * KHÔNG `list_type`/`plate_number`/`plate_raw` — bất biến sau khi tạo (spec §1.2, DATA-02).
 * Đổi loại danh sách/biển = xóa-mềm bản ghi cũ + tạo bản ghi mới. `whitelist:true` loại
 * field thừa nếu client lén gửi. Cả 2 field absent → no-op ở service (trả nguyên trạng).
 */
export class UpdateVehicleControlListDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
