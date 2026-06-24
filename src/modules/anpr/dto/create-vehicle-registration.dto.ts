import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { Expose } from 'class-transformer';

/**
 * CreateVehicleRegistrationDto (VPR-001 / UC1) — body route USER tự đăng ký biển.
 *
 * KHÔNG có `user_id`: route user lấy user_id từ JWT (@CurrentUser). ValidationPipe
 * `whitelist:true` loại mọi field thừa (kể cả user_id nếu client lén truyền) — SEC-01.
 */
export class CreateVehicleRegistrationDto {
  @Expose({ name: 'plate_raw' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  plateRaw: string;

  @Expose({ name: 'vehicle_type' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
