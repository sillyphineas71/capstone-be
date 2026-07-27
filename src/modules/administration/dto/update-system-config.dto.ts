import { IsIn, IsString } from 'class-validator';
import { SYSTEM_CONFIG_ALLOWED_KEYS } from '../constants/system-config-allowlist.js';

/**
 * UpdateSystemConfigDto (BE-09) — khớp đúng SystemSettings.jsx:177
 * (`updateSystemConfig({ key, value: String(configs[key]) })`) — `value` LUÔN là string.
 */
export class UpdateSystemConfigDto {
  @IsIn(SYSTEM_CONFIG_ALLOWED_KEYS, {
    message: 'Key cấu hình không hợp lệ hoặc không nằm trong allowlist',
  })
  key: string;

  @IsString({ message: 'Value phải là chuỗi ký tự' })
  value: string;
}
