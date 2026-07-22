import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateZoneDto } from './create-zone.dto.js';

/** Body tối thiểu hợp lệ (3 field bắt buộc) — dùng làm nền cho các case lỗi. */
const validBody = {
  zone_code: 'GATE-01',
  zone_name: 'Cổng chính',
  zone_type: 'gate',
};

const validateBody = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(CreateZoneDto, body);
  return validate(dto);
};

const propertiesOf = (errors: Awaited<ReturnType<typeof validate>>) =>
  errors.map((e) => e.property);

describe('CreateZoneDto (ZNC-001 / UC-90)', () => {
  it('body chỉ 3 field bắt buộc → 0 lỗi (building/floor nullable — OQ-6)', async () => {
    const errors = await validateBody(validBody);
    expect(errors).toHaveLength(0);
  });

  it('thiếu zone_type → LỖI validate (OQ-4: required, KHÔNG rơi về DB default room)', async () => {
    const { zone_type, ...body } = validBody;
    void zone_type;
    const errors = await validateBody(body);
    expect(propertiesOf(errors)).toContain('zoneType');
    expect(
      errors.find((e) => e.property === 'zoneType')?.constraints,
    ).toHaveProperty('isIn');
  });

  it('zone_type ngoài danh sách (garden) → lỗi isIn', async () => {
    const errors = await validateBody({ ...validBody, zone_type: 'garden' });
    expect(
      errors.find((e) => e.property === 'zoneType')?.constraints,
    ).toHaveProperty('isIn');
  });

  it('5 giá trị hợp lệ đều pass', async () => {
    for (const zone_type of ['room', 'gate', 'corridor', 'lobby', 'parking']) {
      const errors = await validateBody({ ...validBody, zone_type });
      expect(errors).toHaveLength(0);
    }
  });

  it('vượt MaxLength → lỗi maxLength (zone_code 81 / zone_name 151 / floor 31)', async () => {
    const codeErrors = await validateBody({
      ...validBody,
      zone_code: 'A'.repeat(81),
    });
    expect(
      codeErrors.find((e) => e.property === 'zoneCode')?.constraints,
    ).toHaveProperty('maxLength');

    const nameErrors = await validateBody({
      ...validBody,
      zone_name: 'B'.repeat(151),
    });
    expect(
      nameErrors.find((e) => e.property === 'zoneName')?.constraints,
    ).toHaveProperty('maxLength');

    const floorErrors = await validateBody({
      ...validBody,
      floor: 'C'.repeat(31),
    });
    expect(
      floorErrors.find((e) => e.property === 'floor')?.constraints,
    ).toHaveProperty('maxLength');
  });

  it('thiếu zone_code / thiếu zone_name → lỗi', async () => {
    const { zone_code, ...noCode } = validBody;
    void zone_code;
    expect(propertiesOf(await validateBody(noCode))).toContain('zoneCode');

    const { zone_name, ...noName } = validBody;
    void zone_name;
    expect(propertiesOf(await validateBody(noName))).toContain('zoneName');
  });

  // `whitelist` là option của ValidationPipe, KHÔNG phải của plainToInstance ⇒ case này
  // PHẢI đi qua pipe thật, không dùng plainToInstance.
  it('ValidationPipe whitelist loại field lạ (status/id/deleted_at)', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = (await pipe.transform(
      {
        ...validBody,
        status: 'inactive',
        id: '00000000-0000-0000-0000-000000000000',
        deleted_at: '2026-07-22T00:00:00.000Z',
      },
      { type: 'body', metatype: CreateZoneDto },
    )) as CreateZoneDto & Record<string, unknown>;

    expect(result).toBeInstanceOf(CreateZoneDto);
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('deleted_at');
    // 3 field hợp lệ vẫn còn nguyên sau khi strip.
    expect(result.zoneCode).toBe('GATE-01');
    expect(result.zoneName).toBe('Cổng chính');
    expect(result.zoneType).toBe('gate');
  });
});
