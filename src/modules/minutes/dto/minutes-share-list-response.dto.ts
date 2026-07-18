/**
 * Response cho GET /meeting-minutes/:id/shares (danh sách user đang được share).
 */
export class MinutesShareListItemDto {
  id: string;
  userId: string;
  userFullName: string;
  userEmail: string;
  grantedBy: string;
  grantedByName: string;
  grantedAt: Date;

  constructor(data: Partial<MinutesShareListItemDto>) {
    Object.assign(this, data);
  }
}

export class MinutesShareListResponseDto {
  minutesId: string;
  shares: MinutesShareListItemDto[];

  constructor(data: Partial<MinutesShareListResponseDto>) {
    Object.assign(this, data);
  }
}
