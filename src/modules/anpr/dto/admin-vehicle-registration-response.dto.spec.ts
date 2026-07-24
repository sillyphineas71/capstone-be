import { VehicleRegistrationEntity } from '../entities/vehicle-registration.entity.js';
import { toAdminVehicleRegistrationResponse } from './admin-vehicle-registration-response.dto.js';

const baseEntity = (): VehicleRegistrationEntity =>
  ({
    id: 'veh1',
    userId: 'u1',
    plateRaw: '30A-123.45',
    plateNumber: '30A12345',
    vehicleType: 'car',
    note: null,
    status: 'active',
    createdAt: new Date('2026-07-23T00:00:00Z'),
    updatedAt: new Date('2026-07-23T00:00:00Z'),
    deletedAt: null,
  }) as VehicleRegistrationEntity;

describe('toAdminVehicleRegistrationResponse (UC-101)', () => {
  it('vr.user set → owner {user_id, full_name, email}; KHÔNG field nhạy cảm', () => {
    const entity = baseEntity();
    entity.user = {
      id: 'u1',
      fullName: 'Nguyen Van A',
      email: 'a@example.com',
      // các field nhạy cảm — PHẢI không xuất hiện trong output
      phoneNumber: '0900000000',
      username: 'nva',
      employeeCode: 'E001',
      passwordHash: 'secret',
    } as VehicleRegistrationEntity['user'];

    const out = toAdminVehicleRegistrationResponse(entity);

    expect(out.owner).toEqual({
      user_id: 'u1',
      full_name: 'Nguyen Van A',
      email: 'a@example.com',
    });
    // 0 field nhạy cảm rò qua khối owner
    const owner = out.owner as Record<string, unknown>;
    expect(owner).not.toHaveProperty('phoneNumber');
    expect(owner).not.toHaveProperty('username');
    expect(owner).not.toHaveProperty('employeeCode');
    expect(owner).not.toHaveProperty('passwordHash');
    expect(owner).not.toHaveProperty('phone');
    expect(owner).not.toHaveProperty('department');
  });

  it('vr.user null → owner: null (không nổ)', () => {
    const entity = baseEntity();
    entity.user = null as unknown as VehicleRegistrationEntity['user'];
    const out = toAdminVehicleRegistrationResponse(entity);
    expect(out.owner).toBeNull();
  });

  it('giữ nguyên mọi field của mapper user (không sót field xe)', () => {
    const out = toAdminVehicleRegistrationResponse(baseEntity());
    expect(out.id).toBe('veh1');
    expect(out.user_id).toBe('u1');
    expect(out.plate_raw).toBe('30A-123.45');
    expect(out.plate_number).toBe('30A12345');
    expect(out.vehicle_type).toBe('car');
    expect(out.status).toBe('active');
  });
});
