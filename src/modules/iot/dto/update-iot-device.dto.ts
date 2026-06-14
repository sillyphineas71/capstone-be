import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsIP,
  IsMACAddress,
  ValidateIf,
} from 'class-validator';
import { Expose, Transform } from 'class-transformer';
import { normalizeMacAddress } from '../../../common/utils/mac.util.js';

/**
 * UpdateIotDeviceDto (IOT-011)
 *
 * Allowlist 4 trường mô tả/kết nối: device_name, ip_address, mac_address,
 * network_identifier. Map snake_case (API) <-> camelCase (class) bằng @Expose.
 *
 * - 3 trường kết nối (ip/mac/network): @IsOptional + @ValidateIf(v !== null) ->
 *   vắng mặt hoặc null đều hợp lệ; null = xóa giá trị (set NULL).
 * - device_name (cột NOT NULL): KHÔNG @IsOptional. @ValidateIf(undefined-only) ->
 *   vắng mặt thì bỏ qua, nhưng nếu gửi null -> rơi vào @IsString/@IsNotEmpty -> 400.
 */
export class UpdateIotDeviceDto {
  @Expose({ name: 'device_name' })
  @ValidateIf((o: UpdateIotDeviceDto) => o.deviceName !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  deviceName?: string;

  @Expose({ name: 'ip_address' })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsIP()
  ipAddress?: string | null;

  @Expose({ name: 'mac_address' })
  @IsOptional()
  @Transform(({ value }) =>
    // Giữ nguyên undefined (field vắng mặt) để KHÔNG biến thành null;
    // chỉ normalize khi có chuỗi. null = xóa MAC.
    value === undefined
      ? undefined
      : value === null
        ? null
        : normalizeMacAddress(value),
  )
  @ValidateIf((_o, value) => value !== null)
  @IsMACAddress()
  macAddress?: string | null;

  @Expose({ name: 'network_identifier' })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(150)
  networkIdentifier?: string | null;
}
