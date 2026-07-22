import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssignZoneDevicesDto } from './assign-zone-devices.dto.js';

const uuid = (n: number) =>
  `0000000${n}-0000-4000-8000-000000000000`.slice(-36);

const validateBody = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(AssignZoneDevicesDto, body);
  return validate(dto);
};

const constraintsOf = (errors: Awaited<ReturnType<typeof validate>>) =>
  errors.find((e) => e.property === 'deviceIds')?.constraints;

describe('AssignZoneDevicesDto (ZNA-001 / UC-94)', () => {
  // Case 25
  it('device_ids hợp lệ (1 và 50 phần tử) → 0 lỗi', async () => {
    expect(await validateBody({ device_ids: [uuid(1)] })).toHaveLength(0);

    const fifty = Array.from({ length: 50 }, (_, i) => uuid(i + 1));
    expect(await validateBody({ device_ids: fifty })).toHaveLength(0);
  });

  // Case 26
  it('mảng rỗng → arrayNotEmpty; 51 phần tử → arrayMaxSize; phần tử sai UUID → isUuid', async () => {
    expect(await validateBody({ device_ids: [] })).not.toHaveLength(0);
    expect(
      constraintsOf(await validateBody({ device_ids: [] })),
    ).toHaveProperty('arrayNotEmpty');

    const fiftyOne = Array.from({ length: 51 }, (_, i) => uuid(i + 1));
    expect(
      constraintsOf(await validateBody({ device_ids: fiftyOne })),
    ).toHaveProperty('arrayMaxSize');

    expect(
      constraintsOf(await validateBody({ device_ids: ['not-a-uuid'] })),
    ).toHaveProperty('isUuid');
  });

  // Case 26b — lớp 3 chống 404 báo sai: id trùng phải bị chặn ngay ở DTO.
  it('device_ids trùng lặp [U1, U1, U2] → lỗi arrayUnique', async () => {
    const errors = await validateBody({
      device_ids: [uuid(1), uuid(1), uuid(2)],
    });

    expect(constraintsOf(errors)).toHaveProperty('arrayUnique');
  });

  // Case 27
  it('ValidationPipe whitelist loại zone_id / room_id', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = (await pipe.transform(
      {
        device_ids: [uuid(1), uuid(2)],
        zone_id: uuid(9),
        room_id: uuid(8),
      },
      { type: 'body', metatype: AssignZoneDevicesDto },
    )) as AssignZoneDevicesDto & Record<string, unknown>;

    expect(result).toBeInstanceOf(AssignZoneDevicesDto);
    expect(result).not.toHaveProperty('zone_id');
    expect(result).not.toHaveProperty('room_id');
    expect(result.deviceIds).toEqual([uuid(1), uuid(2)]);
  });
});
