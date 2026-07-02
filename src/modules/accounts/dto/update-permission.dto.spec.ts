import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdatePermissionDto } from './update-permission.dto.js';

describe('UpdatePermissionDto Validation', () => {
  it('should accept empty body (no fields required)', async () => {
    const dto = plainToInstance(UpdatePermissionDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should accept valid permissionName update', async () => {
    const dto = plainToInstance(UpdatePermissionDto, {
      permissionName: 'Updated Name',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should accept valid description update', async () => {
    const dto = plainToInstance(UpdatePermissionDto, {
      description: 'Updated description',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should accept both fields', async () => {
    const dto = plainToInstance(UpdatePermissionDto, {
      permissionName: 'New Name',
      description: 'New description',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should accept null description', async () => {
    const dto = plainToInstance(UpdatePermissionDto, { description: null });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject too long permissionName', async () => {
    const dto = plainToInstance(UpdatePermissionDto, {
      permissionName: 'A'.repeat(151),
    });
    const errors = await validate(dto);
    const fieldErrors = errors.filter((e) => e.property === 'permissionName');
    expect(fieldErrors.length).toBeGreaterThan(0);
  });

  // Note: permissionCode is not a field in UpdatePermissionDto — it's rejected at controller level
  it('should have no permissionCode field', async () => {
    const dto = new UpdatePermissionDto();
    expect((dto as any).permissionCode).toBeUndefined();
  });
});
