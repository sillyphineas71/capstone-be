import { GateAccessLogEntity } from '../entities/gate-access-log.entity.js';
import {
  toGateAccessLogResponse,
  toAdminGateAccessLogResponse,
} from './gate-access-log-response.dto.js';

const baseLog = (): GateAccessLogEntity =>
  ({
    id: 'log1',
    zoneId: 'z1',
    deviceId: null,
    eventId: null,
    userId: 'u1',
    vehicleRegistrationId: 'vr1',
    plateNumber: '29A12345',
    direction: 'enter',
    accessTime: new Date('2026-07-23T08:00:00Z'),
    pairedLogId: null,
    durationSeconds: null,
    metadataJson: null,
    createdAt: new Date('2026-07-23T08:00:00Z'),
    zone: { zoneCode: 'GATE-01', zoneName: 'Cong chinh' },
    user: null,
  }) as unknown as GateAccessLogEntity;

describe('toGateAccessLogResponse (user, UC-107)', () => {
  it('có zone_name/plate_number/paired_log_id/duration_seconds; KHÔNG khối user', () => {
    const out = toGateAccessLogResponse(baseLog());
    expect(out.zone_name).toBe('Cong chinh');
    expect(out.plate_number).toBe('29A12345');
    expect(out.direction).toBe('enter');
    expect(out.paired_log_id).toBeNull();
    expect(out.duration_seconds).toBeNull();
    expect(out).not.toHaveProperty('user');
    expect(out).not.toHaveProperty('zone_code');
  });

  it('zone null → zone_name: null (không nổ)', () => {
    const log = baseLog();
    (log as { zone: unknown }).zone = null;
    expect(toGateAccessLogResponse(log).zone_name).toBeNull();
  });
});

describe('toAdminGateAccessLogResponse (admin, UC-107)', () => {
  it('user set → owner {user_id,full_name,email} + zone_code; KHÔNG field nhạy cảm', () => {
    const log = baseLog();
    log.user = {
      id: 'u1',
      fullName: 'Nguyen Van A',
      email: 'a@example.com',
      phoneNumber: '0900000000',
      username: 'nva',
      employeeCode: 'E001',
      passwordHash: 'secret',
    } as unknown as GateAccessLogEntity['user'];

    const out = toAdminGateAccessLogResponse(log);
    expect(out.user).toEqual({
      user_id: 'u1',
      full_name: 'Nguyen Van A',
      email: 'a@example.com',
    });
    expect(out.zone_code).toBe('GATE-01');

    const owner = out.user as Record<string, unknown>;
    expect(owner).not.toHaveProperty('phoneNumber');
    expect(owner).not.toHaveProperty('username');
    expect(owner).not.toHaveProperty('employeeCode');
    expect(owner).not.toHaveProperty('passwordHash');
    expect(owner).not.toHaveProperty('phone');
    expect(owner).not.toHaveProperty('department');
  });

  it('user null → user: null; vẫn giữ mọi field log', () => {
    const out = toAdminGateAccessLogResponse(baseLog());
    expect(out.user).toBeNull();
    expect(out.zone_name).toBe('Cong chinh');
    expect(out.paired_log_id).toBeNull();
  });
});
