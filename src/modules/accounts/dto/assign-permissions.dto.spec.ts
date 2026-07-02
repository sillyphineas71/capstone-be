import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AssignPermissionsDto } from './assign-permissions.dto.js';

describe('AssignPermissionsDto Validation', () => {
  it('should accept valid UUID array', async () => {
    const dto = plainToInstance(AssignPermissionsDto, {
      permissionIds: [
        '550e8400-e29b-41d4-a716-446655440000',
        '550e8400-e29b-41d4-a716-446655440001',
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject empty array', async () => {
    const dto = plainToInstance(AssignPermissionsDto, { permissionIds: [] });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject invalid UUID', async () => {
    const dto = plainToInstance(AssignPermissionsDto, {
      permissionIds: ['not-a-uuid'],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject non-array value', async () => {
    const dto = plainToInstance(AssignPermissionsDto, {
      permissionIds: 'string-not-array',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject missing permissionIds', async () => {
    const dto = plainToInstance(AssignPermissionsDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
