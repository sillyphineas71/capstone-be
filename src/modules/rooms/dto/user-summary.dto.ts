import { Expose } from 'class-transformer';

export class UserSummaryDto {
  @Expose()
  id: string;

  @Expose()
  fullName: string;

  @Expose()
  email: string;
}
