import { IsDefined, IsIn, IsNotEmpty, IsString } from 'class-validator';
import { CHANNEL_MAP_CONFIG_KEYS } from '../constants/channel-map-config.constant.js';

/**
 * PatchChannelMapConfigDto (F7) — body {key, value}. `value` kiểu phụ thuộc `key`
 * (object cho 4 key map, number cho 3 key threshold) → validate thủ công trong
 * ChannelMapConfigService (mirror SystemConfigService.validateValue, cùng lý do:
 * điều kiện theo key không biểu diễn được bằng decorator tĩnh).
 *
 * `@IsDefined` trên `value` (thay vì để trống decorator) để ValidationPipe({whitelist:true})
 * không strip field này — property không có decorator nào bị whitelist loại khỏi body.
 */
export class PatchChannelMapConfigDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(CHANNEL_MAP_CONFIG_KEYS, {
    message: 'Key cấu hình không nằm trong danh sách 7 key cho phép',
  })
  key: string;

  @IsDefined({ message: 'value là bắt buộc' })
  value: unknown;
}
