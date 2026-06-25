import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Expose } from 'class-transformer';

/**
 * UpdateVehicleRegistrationDto (VPM-001 / UC2) — body PATCH sửa metadata biển.
 *
 * DATA-01: CHỈ `note` + `vehicle_type`. KHÔNG `plate_number`/`plate_raw`/`user_id`/`status`
 * (ValidationPipe `whitelist:true` loại field thừa nếu client lén gửi).
 *
 * undefined vs null (service xử theo `!== undefined`):
 * - field KHÔNG gửi → undefined → giữ nguyên.
 * - field gửi = null → set null (xóa note). (@IsOptional cho phép null.)
 */
export class UpdateVehicleRegistrationDto {
  @Expose({ name: 'vehicle_type' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleType?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string | null;
}
