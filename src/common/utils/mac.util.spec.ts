import { normalizeMacAddress } from './mac.util';

describe('normalizeMacAddress', () => {
  it('should return null for empty or null input', () => {
    expect(normalizeMacAddress(null)).toBeNull();
    expect(normalizeMacAddress(undefined)).toBeNull();
    expect(normalizeMacAddress('')).toBeNull();
    expect(normalizeMacAddress('   ')).toBeNull();
  });

  it('should normalize MAC address with hyphens', () => {
    expect(normalizeMacAddress('00-1a-2b-3c-4d-5e')).toBe('00:1A:2B:3C:4D:5E');
    expect(normalizeMacAddress('00-1A-2B-3C-4D-5E')).toBe('00:1A:2B:3C:4D:5E');
  });

  it('should normalize MAC address with colons', () => {
    expect(normalizeMacAddress('00:1a:2b:3c:4d:5e')).toBe('00:1A:2B:3C:4D:5E');
    expect(normalizeMacAddress('00:1A:2B:3C:4D:5E')).toBe('00:1A:2B:3C:4D:5E');
  });

  it('should trim whitespace', () => {
    expect(normalizeMacAddress('  00-1a-2b-3c-4d-5e  ')).toBe(
      '00:1A:2B:3C:4D:5E',
    );
  });
});
