import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { QueryDashboardOverviewDto } from '../dto/query-dashboard-overview.dto';

// Valid UUID v4 examples
const UUID_V4_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_V4_B = 'c3e2946c-6c4f-4fe6-b68a-7f374c80d22a';

describe('QueryDashboardOverviewDto', () => {
  it('valid params -> passes', async () => {
    const dto = plainToInstance(QueryDashboardOverviewDto, {
      from: '2026-06-01',
      to: '2026-06-30',
      departmentId: UUID_V4_A,
      roomId: UUID_V4_B,
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('empty params -> passes (all optional)', async () => {
    const dto = plainToInstance(QueryDashboardOverviewDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('invalid from format -> error', async () => {
    const dto = plainToInstance(QueryDashboardOverviewDto, {
      from: 'not-a-date',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid to format -> error', async () => {
    const dto = plainToInstance(QueryDashboardOverviewDto, {
      to: '2026/06/30',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid departmentId (not UUID) -> error', async () => {
    const dto = plainToInstance(QueryDashboardOverviewDto, {
      departmentId: 'not-a-uuid',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid roomId (not UUID) -> error', async () => {
    const dto = plainToInstance(QueryDashboardOverviewDto, {
      roomId: 'abc',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('valid UUID v4 for departmentId -> passes', async () => {
    const dto = plainToInstance(QueryDashboardOverviewDto, {
      departmentId: UUID_V4_A,
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('valid ISO date strings -> passes', async () => {
    const dto = plainToInstance(QueryDashboardOverviewDto, {
      from: '2026-01-15',
      to: '2026-12-31',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});
