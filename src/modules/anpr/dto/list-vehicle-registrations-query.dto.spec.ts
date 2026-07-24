import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListVehicleRegistrationsQueryDto } from './list-vehicle-registrations-query.dto.js';

const validateBody = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(ListVehicleRegistrationsQueryDto, body);
  return validate(dto);
};

const errOn = (
  errors: Awaited<ReturnType<typeof validate>>,
  property: string,
) => errors.find((e) => e.property === property)?.constraints;

describe('ListVehicleRegistrationsQueryDto (UC-101 mở rộng)', () => {
  it('query rỗng {} → 0 lỗi', async () => {
    expect(await validateBody({})).toHaveLength(0);
  });

  it('plate ≤20 → 0 lỗi; 21 ký tự → maxLength', async () => {
    expect(await validateBody({ plate: '29A12345' })).toHaveLength(0);
    expect(
      errOn(await validateBody({ plate: 'A'.repeat(21) }), 'plate'),
    ).toHaveProperty('maxLength');
  });

  it('vehicle_type chuỗi bất kỳ (KHÔNG @IsIn) → 0 lỗi; 51 ký tự → maxLength', async () => {
    expect(await validateBody({ vehicle_type: 'ô tô' })).toHaveLength(0);
    expect(await validateBody({ vehicle_type: 'Car' })).toHaveLength(0);
    expect(
      errOn(
        await validateBody({ vehicle_type: 'x'.repeat(51) }),
        'vehicleType',
      ),
    ).toHaveProperty('maxLength');
  });

  it('@Expose({name:vehicle_type}): gửi snake_case → property vehicleType', () => {
    const dto = plainToInstance(ListVehicleRegistrationsQueryDto, {
      vehicle_type: 'car',
    });
    expect(dto.vehicleType).toBe('car');
  });

  it('SEC-01 whitelist: route user loại user_id/owner, giữ plate', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = (await pipe.transform(
      { user_id: 'x', owner: 'y', plate: '29A' },
      { type: 'query', metatype: ListVehicleRegistrationsQueryDto },
    )) as ListVehicleRegistrationsQueryDto & Record<string, unknown>;

    expect(result).not.toHaveProperty('user_id');
    expect(result).not.toHaveProperty('owner');
    expect(result).not.toHaveProperty('userId');
    expect(result.plate).toBe('29A');
  });
});
