import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { QueryNoShowRateDto } from '../dto/query-no-show-rate.dto';

const UUID_V4_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_V4_B = 'c3e2946c-6c4f-4fe6-b68a-7f374c80d22a';

describe('QueryNoShowRateDto', () => {
  it('valid params -> passes', async () => {
    const dto = plainToInstance(QueryNoShowRateDto, {
      preset: 'month',
      from: '2026-06-01',
      to: '2026-06-30',
      departmentIds: [UUID_V4_A, UUID_V4_B],
      roomId: UUID_V4_A,
      organizerEmail: 'user@company.com',
      rankBy: 'room',
      page: 1,
      limit: 20,
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('empty params -> passes (all optional)', async () => {
    const dto = plainToInstance(QueryNoShowRateDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('invalid preset -> error', async () => {
    const dto = plainToInstance(QueryNoShowRateDto, {
      preset: 'hour',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid from format -> error', async () => {
    const dto = plainToInstance(QueryNoShowRateDto, {
      from: 'not-a-date',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid to format -> error', async () => {
    const dto = plainToInstance(QueryNoShowRateDto, {
      to: 'invalid-date',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid roomId (not UUID) -> error', async () => {
    const dto = plainToInstance(QueryNoShowRateDto, {
      roomId: 'not-uuid',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid organizerEmail -> error', async () => {
    const dto = plainToInstance(QueryNoShowRateDto, {
      organizerEmail: 'not-an-email',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid rankBy -> error', async () => {
    const dto = plainToInstance(QueryNoShowRateDto, {
      rankBy: 'user',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid page (not integer) -> error', async () => {
    const dto = plainToInstance(QueryNoShowRateDto, {
      page: 1.5,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid page (< 1) -> error', async () => {
    const dto = plainToInstance(QueryNoShowRateDto, {
      page: 0,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid limit (> 100) -> error', async () => {
    const dto = plainToInstance(QueryNoShowRateDto, {
      limit: 101,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('transforms comma-separated string to array and passes', async () => {
    const dto = plainToInstance(QueryNoShowRateDto, {
      departmentIds: `${UUID_V4_A},${UUID_V4_B}`,
    });
    expect(dto.departmentIds).toEqual([UUID_V4_A, UUID_V4_B]);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});
