import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateDepartmentDto } from './update-department.dto.js';

/**
 * ACCT-DEPT-DEACTIVATE-001 — AC-010: PATCH /departments/:id không còn nhận
 * field `isActive` (đã chuyển sang POST /departments/:id/deactivate|reactivate).
 * `whitelist: true, forbidNonWhitelisted: true` mirror đúng ValidationPipe
 * dùng trong `departments.controller.ts` cho route PATCH :id.
 */
describe('UpdateDepartmentDto Validation', () => {
  it('[AC-010] should reject body containing isActive (forbidNonWhitelisted)', async () => {
    const dto = plainToInstance(UpdateDepartmentDto, {
      isActive: false,
    } as Record<string, unknown>);

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'isActive')).toBe(true);
  });

  it('should accept a normal partial update body (no isActive)', async () => {
    const dto = plainToInstance(UpdateDepartmentDto, {
      departmentName: 'Phong CNTT moi',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.length).toBe(0);
  });

  it('should accept an empty body at DTO level (business rule EMPTY_UPDATE_PAYLOAD is enforced in service, not DTO)', async () => {
    const dto = plainToInstance(UpdateDepartmentDto, {});

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.length).toBe(0);
  });
});
