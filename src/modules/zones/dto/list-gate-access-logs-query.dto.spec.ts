import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListGateAccessLogsQueryDto } from './list-gate-access-logs-query.dto.js';
import { GATE_DIRECTIONS } from '../constants/gate-direction.constant.js';

const UUID = '11111111-1111-4111-8111-111111111111';

const validateBody = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(ListGateAccessLogsQueryDto, body);
  return validate(dto);
};

const errOn = (
  errors: Awaited<ReturnType<typeof validate>>,
  property: string,
) => errors.find((e) => e.property === property)?.constraints;

describe('GATE_DIRECTIONS constant (UC-107 / §1.1)', () => {
  it('đúng ["enter","leave"] — không "seen"/"in"/"out"', () => {
    expect([...GATE_DIRECTIONS]).toEqual(['enter', 'leave']);
    expect(GATE_DIRECTIONS).not.toContain('seen');
    expect(GATE_DIRECTIONS).not.toContain('in');
    expect(GATE_DIRECTIONS).not.toContain('out');
  });
});

describe('ListGateAccessLogsQueryDto (UC-107)', () => {
  it('query rỗng {} → 0 lỗi (default page/limit)', async () => {
    expect(await validateBody({})).toHaveLength(0);
  });

  it('from/to sai định dạng → isIso8601; đúng ISO8601 → 0 lỗi', async () => {
    expect(
      errOn(await validateBody({ from: 'not-a-date' }), 'from'),
    ).toHaveProperty('isIso8601');
    expect(
      await validateBody({
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T23:59:59Z',
      }),
    ).toHaveLength(0);
  });

  it('direction="in" (từ vựng cũ) → lỗi isIn; "enter" → 0 lỗi', async () => {
    expect(
      errOn(await validateBody({ direction: 'in' }), 'direction'),
    ).toHaveProperty('isIn');
    expect(await validateBody({ direction: 'enter' })).toHaveLength(0);
    expect(await validateBody({ direction: 'leave' })).toHaveLength(0);
  });

  it('zone_id không UUID → isUuid', async () => {
    const dto = plainToInstance(ListGateAccessLogsQueryDto, {
      zone_id: 'not-a-uuid',
    });
    expect(errOn(await validate(dto), 'zoneId')).toHaveProperty('isUuid');
  });

  it('limit=101 → max; page=0 → min', async () => {
    expect(errOn(await validateBody({ limit: 101 }), 'limit')).toHaveProperty(
      'max',
    );
    expect(errOn(await validateBody({ page: 0 }), 'page')).toHaveProperty(
      'min',
    );
  });

  it('SEC-01 whitelist: loại user_id/plate, giữ direction', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = (await pipe.transform(
      { user_id: UUID, plate: '29A123', direction: 'enter' },
      { type: 'query', metatype: ListGateAccessLogsQueryDto },
    )) as ListGateAccessLogsQueryDto & Record<string, unknown>;

    expect(result).not.toHaveProperty('user_id');
    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('plate');
    expect(result.direction).toBe('enter');
  });

  it('@Expose({name:zone_id}): snake_case → property zoneId', () => {
    const dto = plainToInstance(ListGateAccessLogsQueryDto, { zone_id: UUID });
    expect(dto.zoneId).toBe(UUID);
  });
});
