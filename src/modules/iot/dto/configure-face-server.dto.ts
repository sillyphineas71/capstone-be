import {
  IsBoolean,
  IsOptional,
  IsIn,
  IsUrl,
  IsIP,
  IsNotEmpty,
  IsString,
  Matches,
} from 'class-validator';

export class ConfigureFaceServerDto {
  @IsBoolean()
  @IsOptional()
  callback_enabled?: boolean;

  @IsIn(['http', 'https'])
  callback_protocol: 'http' | 'https';

  @IsUrl({ require_tld: false })
  @IsOptional()
  callback_base_url?: string;

  @IsIP()
  @IsNotEmpty()
  allowed_source_ip: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\/[a-zA-Z0-9-_\/]+$/, {
    message: 'heartbeat_path must be a valid path starting with /',
  })
  heartbeat_path: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\/[a-zA-Z0-9-_\/]+$/, {
    message: 'verify_path must be a valid path starting with /',
  })
  verify_path: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\/[a-zA-Z0-9-_\/]+$/, {
    message: 'stranger_path must be a valid path starting with /',
  })
  stranger_path: string;

  /**
   * Chiều BE→thiết bị (gọi /webs/login của chính FaceGate để upload ảnh/thêm người) —
   * trước đây KHÔNG có field nào trong DTO để nhập, chỉ set được bằng cách sửa tay DB.
   * base_url optional: bỏ trống → FaceDeviceProviderFactory tự fallback sang
   * `http://${ip_address}` (xem face-device-provider.factory.ts:36-37).
   */
  @IsUrl({ require_tld: false })
  @IsOptional()
  base_url?: string;

  @IsString()
  @IsOptional()
  username?: string;

  /** Plaintext qua HTTPS — service mã hoá AES-256-GCM (encryptSecret) trước khi lưu DB. */
  @IsString()
  @IsOptional()
  password?: string;
}
