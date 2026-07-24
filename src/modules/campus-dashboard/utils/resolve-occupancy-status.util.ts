import {
  IoTDeviceEntity,
  IoTDeviceStatus,
  IoTDeviceType,
} from '../../iot/entities/iot-device.entity.js';
import { ZonePresenceEventEntity } from '../../zones/entities/zone-presence-event.entity.js';

/** CDB-001 §2.3: thiết bị loại này CÓ heartbeat cập nhật `status` tự động (mirror CLAUDE.md 11.2). */
export const HEARTBEAT_DEVICE_TYPES: IoTDeviceType[] = [
  IoTDeviceType.FACE_SERVER,
  IoTDeviceType.DOOR_CAMERA,
];

export interface OccupancyResult {
  status: 'ok' | 'no_data';
  count: number | null;
}

/**
 * resolveOccupancyStatus (CDB-001 / UC-126 §2.3) — kết hợp `iot_devices.status` (ưu tiên nếu
 * zone có thiết bị loại có heartbeat) với độ mới `zone_presence_events` (fallback cho IVSS
 * không heartbeat) để quyết định occupancy có đáng tin ('ok') hay 'no_data'.
 *
 * `count` LUÔN trả giá trị đếm mới nhất tìm được (kể cả khi status='no_data') — KHÔNG tự ý
 * trả 0 khi chưa từng có event (spec R4).
 */
export function resolveOccupancyStatus(
  devicesInZone: IoTDeviceEntity[],
  latestCountEvent: ZonePresenceEventEntity | null,
  stalenessMinutes: number,
  now: Date,
): OccupancyResult {
  const count = latestCountEvent?.occupancyCount ?? null;

  const heartbeatDevices = devicesInZone.filter((d) =>
    HEARTBEAT_DEVICE_TYPES.includes(d.deviceType),
  );

  if (heartbeatDevices.length > 0) {
    const anyOnline = heartbeatDevices.some(
      (d) => d.status === IoTDeviceStatus.ONLINE,
    );
    return { status: anyOnline ? 'ok' : 'no_data', count };
  }

  if (!latestCountEvent) {
    return { status: 'no_data', count: null };
  }

  const ageMinutes =
    (now.getTime() - latestCountEvent.eventTime.getTime()) / 60000;
  return { status: ageMinutes <= stalenessMinutes ? 'ok' : 'no_data', count };
}
