/**
 * ChannelMapConfigItemDto (F7) — 1 dòng trong GET /system-configurations/channel-maps.
 * `value`: object {channelId: uuid|direction} cho key kind='map', number cho
 * kind='threshold', `null` nếu key chưa từng được set (chưa có row trong system_configs
 * — code phía reader tự fallback default riêng, xem constant `description`).
 */
export class ChannelMapConfigItemDto {
  key: string;
  kind: 'map' | 'threshold';
  value: Record<string, string> | number | null;
  configGroup: string;
  description: string;
  updatedAt: Date | null;
}
