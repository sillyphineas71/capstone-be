import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { QueryMeetingCountByPeriodDto } from '../dto/query-meeting-count-by-period.dto';
import { MeetingType } from '../../meetings/entities/meeting.entity';

const UUID_V4 = '550e8400-e29b-41d4-a716-446655440000';

describe('QueryMeetingCountByPeriodDto', () => {
  it('valid params -> passes', async () => {
    const dto = plainToInstance(QueryMeetingCountByPeriodDto, {
      from: '2026-06-01',
      to: '2026-06-30',
      granularity: 'week',
      departmentId: UUID_V4,
      roomId: UUID_V4,
      meetingType: MeetingType.NORMAL,
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('empty params -> passes (all optional)', async () => {
    const dto = plainToInstance(QueryMeetingCountByPeriodDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('invalid granularity -> error', async () => {
    const dto = plainToInstance(QueryMeetingCountByPeriodDto, {
      granularity: 'day',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid from format -> error', async () => {
    const dto = plainToInstance(QueryMeetingCountByPeriodDto, {
      from: 'not-a-date',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid to format -> error', async () => {
    const dto = plainToInstance(QueryMeetingCountByPeriodDto, {
      to: 'invalid-date',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid departmentId (not UUID) -> error', async () => {
    const dto = plainToInstance(QueryMeetingCountByPeriodDto, {
      departmentId: 'not-uuid',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid roomId (not UUID) -> error', async () => {
    const dto = plainToInstance(QueryMeetingCountByPeriodDto, {
      roomId: 'not-uuid',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('invalid meetingType -> error', async () => {
    const dto = plainToInstance(QueryMeetingCountByPeriodDto, {
      meetingType: 'invalid-type',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
