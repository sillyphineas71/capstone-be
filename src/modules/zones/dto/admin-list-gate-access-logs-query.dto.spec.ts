import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminListGateAccessLogsQueryDto } from './admin-list-gate-access-logs-query.dto.js';

const UUID = '11111111-1111-4111-8111-111111111111';

const validateBody = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(AdminListGateAccessLogsQueryDto, body);
  return validate(dto);
};

const errOn = (
  errors: Awaited<ReturnType<typeof validate>>,
  property: string,
) => errors.find((e) => e.property === property)?.constraints;

describe('AdminListGateAccessLogsQueryDto (UC-107)', () => {
  it('extends: nhận đủ field cha (from/to/direction/zone_id) + con (user_id/plate)', async () => {
    const dto = plainToInstance(AdminListGateAccessLogsQueryDto, {
      from: '2026-07-01T00:00:00Z',
      direction: 'enter',
      zone_id: UUID,
      user_id: UUID,
      plate: '29A123',
    });
    expect(dto.from).toBe('2026-07-01T00:00:00Z');
    expect(dto.direction).toBe('enter');
    expect(dto.zoneId).toBe(UUID);
    expect(dto.userId).toBe(UUID);
    expect(dto.plate).toBe('29A123');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('user_id không UUID → isUuid; UUID hợp lệ → 0 lỗi', async () => {
    expect(
      errOn(await validateBody({ user_id: 'not-a-uuid' }), 'userId'),
    ).toHaveProperty('isUuid');
    expect(await validateBody({ user_id: UUID })).toHaveLength(0);
  });

  it('plate 21 ký tự → maxLength; ≤20 → 0 lỗi', async () => {
    expect(
      errOn(await validateBody({ plate: 'A'.repeat(21) }), 'plate'),
    ).toHaveProperty('maxLength');
    expect(await validateBody({ plate: 'A'.repeat(20) })).toHaveLength(0);
  });

  it('kế thừa ràng buộc cha: limit=101 → max; direction="in" → isIn', async () => {
    expect(errOn(await validateBody({ limit: 101 }), 'limit')).toHaveProperty(
      'max',
    );
    expect(
      errOn(await validateBody({ direction: 'in' }), 'direction'),
    ).toHaveProperty('isIn');
  });
});
