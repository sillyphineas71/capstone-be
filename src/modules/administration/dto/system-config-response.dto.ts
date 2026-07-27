/**
 * SystemConfigResponseDto (BE-09) — field `key`/`value` (KHÔNG phải
 * `configKey`/`configValue`) vì FE đọc `item.key`/`item.value`
 * (`SystemSettings.jsx:52-58`).
 */
export class SystemConfigResponseDto {
  id: string;
  key: string;
  /** Giá trị dạng string luôn (kể cả number/boolean) — FE tự parse. `null` nếu is_sensitive và masked. */
  value: string | null;
  valueType: string;
  configGroup: string;
  description: string | null;
  isSensitive: boolean;
  updatedAt: Date;
}
