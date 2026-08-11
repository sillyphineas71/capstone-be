import { SetMetadata } from '@nestjs/common';

export const ALLOW_PARTNER_ACCOUNT_KEY = 'allowPartnerAccount';
export const AllowPartnerAccount = () =>
  SetMetadata(ALLOW_PARTNER_ACCOUNT_KEY, true);