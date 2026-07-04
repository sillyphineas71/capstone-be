import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { QueryRoomUtilizationRateDto } from '../dto/query-room-utilization-rate.dto';

const UUID_V4 = '550e8400-e29b-41d4-a716-446655440000';

describe('QueryRoomUtilizationRateDto', () => {
  it('valid params -> passes', async () => {
    const dto = plainToInstance(QueryRoomUtilizationRateDto, {
      preset: 'month',
      from: '2026-06-01',
      to: '2026-06-30',
      comparisonMode: 'previous_period',
      roomId: UUID_V4,
      granularity: 'day',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('empty params -> passes (all optional)', async () => {
    const dto = plainToInstance(QueryRoomUtilizationRateDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('invalid preset -> error', async () => {
    const dto = plainToInstance(QueryRoomUtilizationRateDto, {
      preset: 'hour',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid comparisonMode -> error', async () => {
    const dto = plainToInstance(QueryRoomUtilizationRateDto, {
      comparisonMode: 'invalid_mode',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid granularity -> error', async () => {
    const dto = plainToInstance(QueryRoomUtilizationRateDto, {
      granularity: 'month',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
