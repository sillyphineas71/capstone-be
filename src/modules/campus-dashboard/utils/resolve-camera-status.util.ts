import {
  IoTDeviceEntity,
  IoTDeviceStatus,
} from '../../iot/entities/iot-device.entity.js';

export interface CameraStatusResult {
  online: number;
  offline: number;
  disabled: number;
  maintenance: number;
  overall: 'no_device' | 'online' | 'degraded' | 'offline';
}

/**
 * resolveCameraStatus (CDB-001 / UC-126 §2.5) — đếm LITERAL số lượng thiết bị theo `status`
 * trong 1 zone + tổng hợp `overall` để hiển thị nhanh. KHÔNG áp suy luận "no_data" ở đây
 * (khác `resolveOccupancyStatus` — xem spec §2.2 lý do tách biệt 2 metric).
 */
export function resolveCameraStatus(
  devicesInZone: IoTDeviceEntity[],
): CameraStatusResult {
  const online = devicesInZone.filter(
    (d) => d.status === IoTDeviceStatus.ONLINE,
  ).length;
  const offline = devicesInZone.filter(
    (d) => d.status === IoTDeviceStatus.OFFLINE,
  ).length;
  const disabled = devicesInZone.filter(
    (d) => d.status === IoTDeviceStatus.DISABLED,
  ).length;
  const maintenance = devicesInZone.filter(
    (d) => d.status === IoTDeviceStatus.MAINTENANCE,
  ).length;

  let overall: CameraStatusResult['overall'];
  if (devicesInZone.length === 0) {
    overall = 'no_device';
  } else if (online > 0) {
    overall = 'online';
  } else if (maintenance > 0 || disabled > 0) {
    overall = 'degraded';
  } else {
    overall = 'offline';
  }

  return { online, offline, disabled, maintenance, overall };
}
