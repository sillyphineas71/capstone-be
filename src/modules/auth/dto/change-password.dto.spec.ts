import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ChangePasswordDto } from './change-password.dto';

/**
 * Helper: create a valid DTO instance then mutate one field.
 */
function buildDto(overrides: Partial<Record<keyof ChangePasswordDto, string>> = {}): ChangePasswordDto {
  return plainToInstance(ChangePasswordDto, {
    currentPassword: 'OldPass@123',
    newPassword: 'NewPass@456',
    confirmPassword: 'NewPass@456',
    ...overrides,
  });
}

describe('ChangePasswordDto — 9 validation test cases (FR-CHPWD-002, AC-003, AC-004, AC-004b)', () => {
  // ─── Test 1: currentPassword empty ────────────────────────────────────────
  it('TC-01: currentPassword empty → validation error (AC-003)', async () => {
    const dto = buildDto({ currentPassword: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'currentPassword')).toBe(true);
  });

  // ─── Test 2: currentPassword > 72 chars ───────────────────────────────────
  it('TC-02: currentPassword > 72 chars → validation error (AC-004b, FR-CHPWD-002)', async () => {
    const dto = buildDto({ currentPassword: 'A'.repeat(73) });
    const errors = await validate(dto);
    const field = errors.find((e) => e.property === 'currentPassword');
    expect(field).toBeDefined();
    expect(field?.constraints).toMatchObject(expect.objectContaining({ maxLength: expect.any(String) }));
  });

  // ─── Test 3: newPassword < 8 chars ────────────────────────────────────────
  it('TC-03: newPassword < 8 chars → validation error (AC-004)', async () => {
    const dto = buildDto({ newPassword: 'Ab@1' }); // 4 chars
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'newPassword')).toBe(true);
  });

  // ─── Test 4: newPassword > 72 chars ───────────────────────────────────────
  it('TC-04: newPassword > 72 chars → validation error (AC-004b)', async () => {
    // 73 chars: starts with uppercase, lowercase, digit, special to pass regex but fail maxLength
    const dto = buildDto({ newPassword: 'Aa1@' + 'b'.repeat(70) }); // 74 chars total
    const errors = await validate(dto);
    const field = errors.find((e) => e.property === 'newPassword');
    expect(field).toBeDefined();
    expect(field?.constraints).toMatchObject(expect.objectContaining({ maxLength: expect.any(String) }));
  });

  // ─── Test 5: newPassword missing uppercase ─────────────────────────────────
  it('TC-05: newPassword missing uppercase → validation error (AC-004, FR-CHPWD-002)', async () => {
    const dto = buildDto({ newPassword: 'newpass@123' }); // all lowercase
    const errors = await validate(dto);
    const field = errors.find((e) => e.property === 'newPassword');
    expect(field).toBeDefined();
    expect(field?.constraints?.matches).toBeDefined();
  });

  // ─── Test 6: newPassword missing lowercase ─────────────────────────────────
  it('TC-06: newPassword missing lowercase → validation error (AC-004, FR-CHPWD-002)', async () => {
    const dto = buildDto({ newPassword: 'NEWPASS@123' }); // all uppercase
    const errors = await validate(dto);
    const field = errors.find((e) => e.property === 'newPassword');
    expect(field).toBeDefined();
    expect(field?.constraints?.matches).toBeDefined();
  });

  // ─── Test 7: newPassword missing digit ────────────────────────────────────
  it('TC-07: newPassword missing digit → validation error (AC-004, FR-CHPWD-002)', async () => {
    const dto = buildDto({ newPassword: 'NewPass@@' }); // no digit
    const errors = await validate(dto);
    const field = errors.find((e) => e.property === 'newPassword');
    expect(field).toBeDefined();
    expect(field?.constraints?.matches).toBeDefined();
  });

  // ─── Test 8: newPassword missing special character ─────────────────────────
  it('TC-08: newPassword missing special character → validation error (AC-004)', async () => {
    const dto = buildDto({ newPassword: 'NewPass123' }); // no special char
    const errors = await validate(dto);
    const field = errors.find((e) => e.property === 'newPassword');
    expect(field).toBeDefined();
    expect(field?.constraints?.matches).toBeDefined();
  });

  // ─── Test 9: all fields valid → passes ────────────────────────────────────
  it('TC-09: all fields valid → no validation errors (AC-001)', async () => {
    const dto = buildDto();
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
