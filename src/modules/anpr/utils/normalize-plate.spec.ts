import { normalizePlate } from './normalize-plate.js';

describe('normalizePlate (VPR-001 / UC1)', () => {
  it('ví dụ chuẩn: "30A-123.45" → "30A12345"', () => {
    expect(normalizePlate('30A-123.45')).toBe('30A12345');
  });

  it('lowercase → upper', () => {
    expect(normalizePlate('51f67890')).toBe('51F67890');
  });

  it('strip khoảng trắng / - / . / , / ký tự lạ', () => {
    expect(normalizePlate(' 51F 678.90 ')).toBe('51F67890');
    expect(normalizePlate('29-B1*234@56')).toBe('29B123456');
  });

  it('OQ-2: KHÔNG map O/0,I/1 — giữ nguyên ký tự ("o0i1" → "O0I1")', () => {
    expect(normalizePlate('o0i1')).toBe('O0I1');
  });

  it('chỉ còn [A-Z0-9] sau normalize', () => {
    expect(normalizePlate('  ab-cd.12  ')).toMatch(/^[A-Z0-9]*$/);
  });

  it('undefined/null → "" (KHÔNG String(undefined) = "UNDEFINED")', () => {
    expect(normalizePlate(undefined)).toBe('');
    expect(normalizePlate(null)).toBe('');
  });
});
