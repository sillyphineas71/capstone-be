import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateRoleDto } from './create-role.dto.js';

describe('CreateRoleDto', () => {
  const validDto = {
    roleCode: 'ROOM_COORDINATOR',
    roleName: 'Room Coordinator',
  };

  it('should accept valid input', async () => {
    const dto = plainToInstance(CreateRoleDto, validDto);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject missing roleCode', async () => {
    const dto = plainToInstance(CreateRoleDto, { roleName: 'Test' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'roleCode')).toBe(true);
  });

  it('should reject missing roleName', async () => {
    const dto = plainToInstance(CreateRoleDto, { roleCode: 'TEST' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'roleName')).toBe(true);
  });

  it('should reject roleCode starting with number', async () => {
    const dto = plainToInstance(CreateRoleDto, {
      ...validDto,
      roleCode: '1ROOM',
    });
    const errors = await validate(dto);
    expect(
      errors.filter((e) => e.property === 'roleCode').length,
    ).toBeGreaterThan(0);
  });

  it('should reject roleCode with spaces', async () => {
    const dto = plainToInstance(CreateRoleDto, {
      ...validDto,
      roleCode: 'ROOM OFF',
    });
    const errors = await validate(dto);
    expect(
      errors.filter((e) => e.property === 'roleCode').length,
    ).toBeGreaterThan(0);
  });

  it('should reject roleCode longer than 50 chars', async () => {
    const dto = plainToInstance(CreateRoleDto, {
      ...validDto,
      roleCode: 'A' + 'B'.repeat(50),
    });
    const errors = await validate(dto);
    expect(
      errors.filter((e) => e.property === 'roleCode').length,
    ).toBeGreaterThan(0);
  });

  it('should trim roleCode on transform', async () => {
    const dto = plainToInstance(CreateRoleDto, {
      roleCode: '  test_role  ',
      roleName: 'Test',
    });
    expect(dto.roleCode).toBeTruthy();
  });

  it('should accept valid underscore roleCode', async () => {
    const dto = plainToInstance(CreateRoleDto, {
      roleCode: 'ROOM_COORDINATOR_1',
      roleName: 'Test',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});
