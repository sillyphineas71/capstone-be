/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { IoTDeviceStatus } from '../../iot/entities/iot-device.entity.js';
import { resolveCameraStatus } from './resolve-camera-status.util.js';

describe('resolveCameraStatus (CDB-001 / UC-126 §2.5)', () => {
  const device = (status: IoTDeviceStatus): any => ({
    id: `d-${status}`,
    status,
  });

  it('zone không có device nào → overall=no_device', () => {
    const result = resolveCameraStatus([]);
    expect(result).toEqual({
      online: 0,
      offline: 0,
      disabled: 0,
      maintenance: 0,
      overall: 'no_device',
    });
  });

  it('≥1 device online → overall=online (bất kể còn lại offline)', () => {
    const result = resolveCameraStatus([
      device(IoTDeviceStatus.ONLINE),
      device(IoTDeviceStatus.OFFLINE),
    ]);
    expect(result.overall).toBe('online');
    expect(result.online).toBe(1);
    expect(result.offline).toBe(1);
  });

  it('không ai online nhưng có maintenance/disabled → overall=degraded', () => {
    const result = resolveCameraStatus([
      device(IoTDeviceStatus.MAINTENANCE),
      device(IoTDeviceStatus.OFFLINE),
    ]);
    expect(result.overall).toBe('degraded');
  });

  it('tất cả offline (không maintenance/disabled) → overall=offline', () => {
    const result = resolveCameraStatus([
      device(IoTDeviceStatus.OFFLINE),
      device(IoTDeviceStatus.OFFLINE),
    ]);
    expect(result.overall).toBe('offline');
    expect(result.offline).toBe(2);
  });

  it('đếm đúng cả 4 loại status cùng lúc', () => {
    const result = resolveCameraStatus([
      device(IoTDeviceStatus.ONLINE),
      device(IoTDeviceStatus.OFFLINE),
      device(IoTDeviceStatus.DISABLED),
      device(IoTDeviceStatus.MAINTENANCE),
    ]);
    expect(result).toEqual({
      online: 1,
      offline: 1,
      disabled: 1,
      maintenance: 1,
      overall: 'online',
    });
  });
});
