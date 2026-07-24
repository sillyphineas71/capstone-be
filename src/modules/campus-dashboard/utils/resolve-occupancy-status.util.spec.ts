/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import {
  IoTDeviceType,
  IoTDeviceStatus,
} from '../../iot/entities/iot-device.entity.js';
import { resolveOccupancyStatus } from './resolve-occupancy-status.util.js';

describe('resolveOccupancyStatus (CDB-001 / UC-126 §2.3)', () => {
  const now = new Date('2026-07-23T12:00:00Z');

  const device = (over: any = {}): any => ({
    id: 'dev-1',
    deviceType: IoTDeviceType.FACE_SERVER,
    status: IoTDeviceStatus.ONLINE,
    ...over,
  });

  const event = (over: any = {}): any => ({
    id: 'evt-1',
    occupancyCount: 10,
    eventTime: new Date('2026-07-23T11:55:00Z'), // 5 phút trước now
    ...over,
  });

  it('có device heartbeat online → ok, bất kể event cũ/không có', () => {
    const result = resolveOccupancyStatus([device()], null, 15, now);
    expect(result).toEqual({ status: 'ok', count: null });
  });

  it('có device heartbeat nhưng KHÔNG ai online → no_data', () => {
    const devices = [
      device({ status: IoTDeviceStatus.OFFLINE }),
      device({ id: 'dev-2', status: IoTDeviceStatus.MAINTENANCE }),
    ];
    const result = resolveOccupancyStatus(devices, event(), 15, now);
    expect(result.status).toBe('no_data');
    expect(result.count).toBe(10); // count vẫn trả, không tự ý 0
  });

  it('KHÔNG có device heartbeat + event mới (trong ngưỡng staleness) → ok', () => {
    const devices = [
      device({
        deviceType: IoTDeviceType.IP_CAMERA,
        status: IoTDeviceStatus.OFFLINE,
      }),
    ];
    const result = resolveOccupancyStatus(devices, event(), 15, now);
    expect(result).toEqual({ status: 'ok', count: 10 });
  });

  it('KHÔNG có device heartbeat + event cũ hơn ngưỡng staleness → no_data', () => {
    const staleEvent = event({ eventTime: new Date('2026-07-23T11:00:00Z') }); // 60 phút trước
    const result = resolveOccupancyStatus([], staleEvent, 15, now);
    expect(result.status).toBe('no_data');
    expect(result.count).toBe(10);
  });

  it('KHÔNG có device heartbeat + KHÔNG có event nào → no_data, count=null', () => {
    const result = resolveOccupancyStatus([], null, 15, now);
    expect(result).toEqual({ status: 'no_data', count: null });
  });

  it('event đúng bằng ngưỡng staleness (biên) → vẫn ok (dùng <=)', () => {
    const boundaryEvent = event({
      eventTime: new Date('2026-07-23T11:45:00Z'),
    }); // đúng 15 phút
    const result = resolveOccupancyStatus([], boundaryEvent, 15, now);
    expect(result.status).toBe('ok');
  });
});
