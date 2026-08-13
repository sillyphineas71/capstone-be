import { Expose, Type } from 'class-transformer';

export class UserSummaryDto {
  @Expose()
  id: string;

  @Expose()
  fullName: string;

  @Expose()
  email: string;

  @Expose()
  avatarUrl: string | null;

  constructor(
    id: string,
    fullName: string,
    email: string,
    avatarUrl: string | null = null,
  ) {
    this.id = id;
    this.fullName = fullName;
    this.email = email;
    this.avatarUrl = avatarUrl;
  }
}
