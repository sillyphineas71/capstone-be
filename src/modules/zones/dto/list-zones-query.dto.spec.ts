import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListZonesQueryDto } from './list-zones-query.dto.js';

const validateQuery = async (query: Record<string, unknown>) => {
  const dto = plainToInstance(ListZonesQueryDto, query);
  return validate(dto);
};

const constraintsOf = (
  errors: Awaited<ReturnType<typeof validate>>,
  property: string,
) => errors.find((e) => e.property === property)?.constraints;

describe('ListZonesQueryDto (ZNL-001 / UC-93)', () => {
  // Case 16
  it('query rỗng → 0 lỗi, page/limit nhận default 1/20', async () => {
    const dto = plainToInstance(ListZonesQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  // Case 17
  it('limit=101 → lỗi max; limit=0 và page=0 → lỗi min', async () => {
    expect(
      constraintsOf(await validateQuery({ limit: 101 }), 'limit'),
    ).toHaveProperty('max');
    expect(
      constraintsOf(await validateQuery({ limit: 0 }), 'limit'),
    ).toHaveProperty('min');
    expect(
      constraintsOf(await validateQuery({ page: 0 }), 'page'),
    ).toHaveProperty('min');
  });

  // Case 18 — @Type(() => Number) ép query string sang number
  it('page/limit dạng string từ query → sau transform là number, 0 lỗi', async () => {
    const dto = plainToInstance(ListZonesQueryDto, { page: '2', limit: '50' });

    expect(typeof dto.page).toBe('number');
    expect(typeof dto.limit).toBe('number');
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
    expect(await validate(dto)).toHaveLength(0);
  });

  // Case 19
  it('zone_type / status ngoài danh sách → lỗi isIn', async () => {
    expect(
      constraintsOf(await validateQuery({ zone_type: 'garden' }), 'zoneType'),
    ).toHaveProperty('isIn');
    // status chỉ chấp nhận active | inactive.
    expect(
      constraintsOf(await validateQuery({ status: 'disabled' }), 'status'),
    ).toHaveProperty('isIn');
  });

  it('giá trị hợp lệ của zone_type / status đều pass', async () => {
    for (const zone_type of ['room', 'gate', 'corridor', 'lobby', 'parking']) {
      expect(await validateQuery({ zone_type })).toHaveLength(0);
    }
    for (const status of ['active', 'inactive']) {
      expect(await validateQuery({ status })).toHaveLength(0);
    }
  });

  // Case 20
  it('vượt MaxLength → lỗi maxLength (search 200 / building 100 / floor 30)', async () => {
    expect(
      constraintsOf(await validateQuery({ search: 'a'.repeat(201) }), 'search'),
    ).toHaveProperty('maxLength');
    expect(
      constraintsOf(
        await validateQuery({ building: 'b'.repeat(101) }),
        'building',
      ),
    ).toHaveProperty('maxLength');
    expect(
      constraintsOf(await validateQuery({ floor: 'c'.repeat(31) }), 'floor'),
    ).toHaveProperty('maxLength');
  });

  // Case 21 — whitelist là option của ValidationPipe, không phải plainToInstance
  it('ValidationPipe whitelist loại sort_by / include_deleted / deleted_at', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = (await pipe.transform(
      {
        zone_type: 'gate',
        building: 'A',
        sort_by: 'created_at',
        include_deleted: 'true',
        deleted_at: '2026-07-22T00:00:00.000Z',
      },
      { type: 'query', metatype: ListZonesQueryDto },
    )) as ListZonesQueryDto & Record<string, unknown>;

    expect(result).toBeInstanceOf(ListZonesQueryDto);
    expect(result).not.toHaveProperty('sort_by');
    expect(result).not.toHaveProperty('include_deleted');
    expect(result).not.toHaveProperty('deleted_at');
    // Field hợp lệ còn nguyên.
    expect(result.zoneType).toBe('gate');
    expect(result.building).toBe('A');
  });
});
