import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateRoleDto } from './update-role.dto.js';

describe('UpdateRoleDto', () => {
  it('should accept empty body', async () => {
    const dto = plainToInstance(UpdateRoleDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should accept roleName update', async () => {
    const dto = plainToInstance(UpdateRoleDto, { roleName: 'New Name' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should accept description update', async () => {
    const dto = plainToInstance(UpdateRoleDto, { description: 'New desc' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should accept isActive update', async () => {
    const dto = plainToInstance(UpdateRoleDto, { isActive: false });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject roleName longer than 100', async () => {
    const dto = plainToInstance(UpdateRoleDto, { roleName: 'A'.repeat(101) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'roleName')).toBe(true);
  });

  it('should allow roleCode (no validator for it)', async () => {
    const dto = plainToInstance(UpdateRoleDto, { roleCode: 'SHOULD_NOT' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should allow isSystemRole (no validator for it)', async () => {
    const dto = plainToInstance(UpdateRoleDto, { isSystemRole: true });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});
