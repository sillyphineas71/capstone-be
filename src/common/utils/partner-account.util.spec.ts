import {
  PARTNER_DEPARTMENT_ID,
  isPartnerAccount,
} from './partner-account.util.js';

describe('partner-account.util', () => {
  it('returns true only for the fixed partner department id', () => {
    expect(isPartnerAccount(PARTNER_DEPARTMENT_ID)).toBe(true);
  });

  it('returns false for other or missing department ids', () => {
    expect(isPartnerAccount('11111111-1111-4111-8111-111111111111')).toBe(
      false,
    );
    expect(isPartnerAccount(null)).toBe(false);
    expect(isPartnerAccount(undefined)).toBe(false);
  });
});
