import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminListVehicleRegistrationsQueryDto } from './admin-list-vehicle-registrations-query.dto.js';

const UUID = '11111111-1111-4111-8111-111111111111';

const validateBody = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(AdminListVehicleRegistrationsQueryDto, body);
  return validate(dto);
};

const errOn = (
  errors: Awaited<ReturnType<typeof validate>>,
  property: string,
) => errors.find((e) => e.property === property)?.constraints;

describe('AdminListVehicleRegistrationsQueryDto (UC-101)', () => {
  it('extends: nhận đủ field cha (plate/vehicle_type/status) + con (user_id/owner)', async () => {
    const dto = plainToInstance(AdminListVehicleRegistrationsQueryDto, {
      plate: '29A',
      vehicle_type: 'car',
      user_id: UUID,
      owner: 'nguyen',
    });
    expect(dto.plate).toBe('29A');
    expect(dto.vehicleType).toBe('car');
    expect(dto.userId).toBe(UUID);
    expect(dto.owner).toBe('nguyen');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('user_id không phải UUID v4 → isUuid; UUID hợp lệ → 0 lỗi', async () => {
    expect(
      errOn(await validateBody({ user_id: 'not-a-uuid' }), 'userId'),
    ).toHaveProperty('isUuid');
    expect(await validateBody({ user_id: UUID })).toHaveLength(0);
  });

  it('owner 256 ký tự → maxLength; ≤255 → 0 lỗi', async () => {
    expect(
      errOn(await validateBody({ owner: 'x'.repeat(256) }), 'owner'),
    ).toHaveProperty('maxLength');
    expect(await validateBody({ owner: 'x'.repeat(255) })).toHaveLength(0);
  });

  it('kế thừa ràng buộc cha: limit=101 → max, page=0 → min', async () => {
    expect(errOn(await validateBody({ limit: 101 }), 'limit')).toHaveProperty(
      'max',
    );
    expect(errOn(await validateBody({ page: 0 }), 'page')).toHaveProperty(
      'min',
    );
  });

  it('@Expose({name:user_id}): snake_case → property userId', () => {
    const dto = plainToInstance(AdminListVehicleRegistrationsQueryDto, {
      user_id: UUID,
    });
    expect(dto.userId).toBe(UUID);
  });
});
