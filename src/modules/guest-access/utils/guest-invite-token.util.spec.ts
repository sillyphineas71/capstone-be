import {
  generateGuestInviteSecret,
  hashGuestInviteSecret,
  buildGuestInviteLink,
  parseGuestInviteToken,
  timingSafeEqualHash,
  DUMMY_TOKEN_HASH,
} from './guest-invite-token.util';

describe('guest-invite-token.util', () => {
  describe('generateGuestInviteSecret', () => {
    it('should generate a base64url secret with sufficient length', () => {
      const secret = generateGuestInviteSecret();
      expect(secret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    });

    it('should generate a different secret each call', () => {
      const a = generateGuestInviteSecret();
      const b = generateGuestInviteSecret();
      expect(a).not.toBe(b);
    });
  });

  describe('hashGuestInviteSecret', () => {
    it('should produce a deterministic 64-char hex hash', () => {
      const hash1 = hashGuestInviteSecret('my-secret');
      const hash2 = hashGuestInviteSecret('my-secret');
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce different hashes for different secrets', () => {
      expect(hashGuestInviteSecret('a')).not.toBe(hashGuestInviteSecret('b'));
    });
  });

  describe('buildGuestInviteLink', () => {
    it('should join base url, id, and secret with a dot separator', () => {
      const link = buildGuestInviteLink(
        'https://app.local/guest/join',
        '11111111-1111-1111-1111-111111111111',
        'sekret123',
      );
      expect(link).toBe(
        'https://app.local/guest/join/11111111-1111-1111-1111-111111111111.sekret123',
      );
    });
  });

  describe('parseGuestInviteToken', () => {
    const validId = '11111111-1111-1111-1111-111111111111';
    const validSecret = generateGuestInviteSecret();

    it('should parse a valid token into id + secret', () => {
      const result = parseGuestInviteToken(`${validId}.${validSecret}`);
      expect(result).toEqual({
        externalParticipantId: validId,
        secret: validSecret,
      });
    });

    it('should return null when there is no dot separator', () => {
      expect(parseGuestInviteToken('nodothere')).toBeNull();
    });

    it('should return null when id is not a valid UUID', () => {
      expect(parseGuestInviteToken(`not-a-uuid.${validSecret}`)).toBeNull();
    });

    it('should return null when secret is too short', () => {
      expect(parseGuestInviteToken(`${validId}.short`)).toBeNull();
    });

    it('should return null when secret is empty (trailing dot)', () => {
      expect(parseGuestInviteToken(`${validId}.`)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseGuestInviteToken('')).toBeNull();
    });
  });

  describe('timingSafeEqualHash', () => {
    it('should return true for identical hashes', () => {
      const h = hashGuestInviteSecret('same');
      expect(timingSafeEqualHash(h, h)).toBe(true);
    });

    it('should return false for different hashes of same length', () => {
      const h1 = hashGuestInviteSecret('one');
      const h2 = hashGuestInviteSecret('two');
      expect(timingSafeEqualHash(h1, h2)).toBe(false);
    });

    it('should return false (not throw) for different-length strings', () => {
      expect(timingSafeEqualHash('short', 'a-much-longer-string')).toBe(false);
    });
  });

  describe('DUMMY_TOKEN_HASH', () => {
    it('should be a stable 64-char hex value usable for timing parity', () => {
      expect(DUMMY_TOKEN_HASH).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
