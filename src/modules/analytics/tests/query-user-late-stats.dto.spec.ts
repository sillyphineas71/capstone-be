import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UserLateStatsQueryDto } from '../dto/query-user-late-stats.dto';

const UUID_V4 = '550e8400-e29b-41d4-a716-446655440000';

describe('UserLateStatsQueryDto', () => {
  it('valid params -> passes', async () => {
    const dto = plainToInstance(UserLateStatsQueryDto, {
      preset: 'month',
      from: '2026-06-01',
      to: '2026-06-30',
      departmentId: UUID_V4,
      search: 'John Doe',
      graceMinutes: 5,
      page: 1,
      limit: 10,
      sortBy: 'lateRate',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('empty params -> passes (all optional with defaults)', async () => {
    const dto = plainToInstance(UserLateStatsQueryDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
    expect(dto.sortBy).toBe('lateRate');
  });

  it('invalid preset -> error', async () => {
    const dto = plainToInstance(UserLateStatsQueryDto, {
      preset: 'year',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid departmentId (not UUID) -> error', async () => {
    const dto = plainToInstance(UserLateStatsQueryDto, {
      departmentId: 'not-uuid',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('page < 1 -> error', async () => {
    const dto = plainToInstance(UserLateStatsQueryDto, {
      page: 0,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('limit > 50 -> error', async () => {
    const dto = plainToInstance(UserLateStatsQueryDto, {
      limit: 51,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid sortBy -> error', async () => {
    const dto = plainToInstance(UserLateStatsQueryDto, {
      sortBy: 'invalidField',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
