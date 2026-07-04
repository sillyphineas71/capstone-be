import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { QueryOnTimeRateDto } from '../dto/query-on-time-rate.dto';

const UUID_V4 = '550e8400-e29b-41d4-a716-446655440000';

describe('QueryOnTimeRateDto', () => {
  it('valid params -> passes', async () => {
    const dto = plainToInstance(QueryOnTimeRateDto, {
      preset: 'month',
      from: '2026-06-01',
      to: '2026-06-30',
      departmentId: UUID_V4,
      meetingId: UUID_V4,
      search: 'John Doe',
      graceMinutes: 5,
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('empty params -> passes (all optional)', async () => {
    const dto = plainToInstance(QueryOnTimeRateDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('invalid preset -> error', async () => {
    const dto = plainToInstance(QueryOnTimeRateDto, {
      preset: 'hour',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid from format -> error', async () => {
    const dto = plainToInstance(QueryOnTimeRateDto, {
      from: 'not-a-date',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid departmentId (not UUID) -> error', async () => {
    const dto = plainToInstance(QueryOnTimeRateDto, {
      departmentId: 'not-uuid',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid meetingId (not UUID) -> error', async () => {
    const dto = plainToInstance(QueryOnTimeRateDto, {
      meetingId: 'not-uuid',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('search too long -> error', async () => {
    const dto = plainToInstance(QueryOnTimeRateDto, {
      search: 'a'.repeat(151),
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('negative graceMinutes -> error', async () => {
    const dto = plainToInstance(QueryOnTimeRateDto, {
      graceMinutes: -1,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('non-integer graceMinutes -> error', async () => {
    const dto = plainToInstance(QueryOnTimeRateDto, {
      graceMinutes: 5.5,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
