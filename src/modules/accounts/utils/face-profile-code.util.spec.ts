import { generateFaceProfileCode } from './face-profile-code.util.js';

/**
 * ACCT-BIOMETRIC-SUBMIT-001 — Unit test cho generateFaceProfileCode (BR-PROFILE-CODE).
 */
describe('generateFaceProfileCode', () => {
  it('đúng format FP- + 32 hex uppercase', () => {
    const code = generateFaceProfileCode();
    expect(code).toMatch(/^FP-[0-9A-F]{32}$/);
  });

  it('không chứa dấu gạch ngang trong phần UUID', () => {
    const code = generateFaceProfileCode();
    expect(code.slice(3)).not.toContain('-');
  });

  it('không trùng giữa 2 lần gọi liên tiếp', () => {
    expect(generateFaceProfileCode()).not.toBe(generateFaceProfileCode());
  });
});
