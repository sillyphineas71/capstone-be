import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { ListIotDevicesQueryDto } from './list-iot-devices-query.dto.js';

describe('ListIotDevicesQueryDto (validation + transform)', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const meta = {
    type: 'query' as const,
    metatype: ListIotDevicesQueryDto,
    data: '',
  };

  const run = (q: Record<string, unknown>): Promise<ListIotDevicesQueryDto> =>
    pipe.transform(q, meta) as Promise<ListIotDevicesQueryDto>;

  it('defaults page=1, limit=20 when absent', async () => {
    const dto = await run({});
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('transforms string query -> number', async () => {
    const dto = await run({ page: '2', limit: '50' });
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
  });

  it('maps snake_case device_type/room_id', async () => {
    const dto = await run({
      device_type: 'ip_camera',
      room_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(dto.deviceType).toBe('ip_camera');
    expect(dto.roomId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('rejects limit > 100 with 400', async () => {
    await expect(run({ limit: '101' })).rejects.toThrow(BadRequestException);
  });

  it('rejects page < 1 with 400', async () => {
    await expect(run({ page: '0' })).rejects.toThrow(BadRequestException);
  });

  it('rejects invalid status enum with 400', async () => {
    await expect(run({ status: 'bogus' })).rejects.toThrow(BadRequestException);
  });

  it('rejects invalid device_type enum with 400', async () => {
    await expect(run({ device_type: 'bogus' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid room_id uuid with 400', async () => {
    await expect(run({ room_id: 'not-a-uuid' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects search > 200 chars with 400', async () => {
    await expect(run({ search: 'a'.repeat(201) })).rejects.toThrow(
      BadRequestException,
    );
  });
});
