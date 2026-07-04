import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { QueryMeetingCancelRateDto } from '../dto/query-meeting-cancel-rate.dto';

const UUID_V4_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_V4_B = 'c3e2946c-6c4f-4fe6-b68a-7f374c80d22a';

describe('QueryMeetingCancelRateDto', () => {
  it('valid params -> passes', async () => {
    const dto = plainToInstance(QueryMeetingCancelRateDto, {
      preset: 'month_current',
      from: '2026-06-01',
      to: '2026-06-30',
      granularity: 'week',
      departmentIds: [UUID_V4_A, UUID_V4_B],
      roomId: UUID_V4_A,
      organizerEmail: 'organizer@company.com',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('empty params -> passes (all optional)', async () => {
    const dto = plainToInstance(QueryMeetingCancelRateDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('invalid preset -> error', async () => {
    const dto = plainToInstance(QueryMeetingCancelRateDto, {
      preset: 'day_current',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid granularity -> error (only week and month allowed)', async () => {
    const dto = plainToInstance(QueryMeetingCancelRateDto, {
      granularity: 'day',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid from format -> error', async () => {
    const dto = plainToInstance(QueryMeetingCancelRateDto, {
      from: 'not-a-date',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid to format -> error', async () => {
    const dto = plainToInstance(QueryMeetingCancelRateDto, {
      to: 'invalid-date',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid roomId (not UUID) -> error', async () => {
    const dto = plainToInstance(QueryMeetingCancelRateDto, {
      roomId: 'not-uuid',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid departmentIds (not UUID elements) -> error', async () => {
    const dto = plainToInstance(QueryMeetingCancelRateDto, {
      departmentIds: ['not-uuid-1', UUID_V4_B],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid organizerEmail -> error', async () => {
    const dto = plainToInstance(QueryMeetingCancelRateDto, {
      organizerEmail: 'not-an-email',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('transforms comma-separated string to array and passes', async () => {
    const dto = plainToInstance(QueryMeetingCancelRateDto, {
      departmentIds: `${UUID_V4_A},${UUID_V4_B}`,
    });
    expect(dto.departmentIds).toEqual([UUID_V4_A, UUID_V4_B]);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});
