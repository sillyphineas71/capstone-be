/**
 * Response cho POST (grant) và DELETE (revoke) share biên bản.
 */
export class MinutesShareResponseDto {
  id: string;
  minutesId: string;
  userId: string;
  userFullName: string;
  grantedBy: string;
  grantedAt: Date;

  constructor(data: Partial<MinutesShareResponseDto>) {
    Object.assign(this, data);
  }
}

export class UnshareMinutesResponseDto {
  minutesId: string;
  userId: string;
  revoked: true;

  constructor(data: Partial<UnshareMinutesResponseDto>) {
    Object.assign(this, data);
  }
}
