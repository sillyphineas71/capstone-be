import { Expose, Type } from 'class-transformer';

export class UserSummaryDto {
  @Expose()
  id: string;

  @Expose()
  fullName: string;

  @Expose()
  email: string;

  constructor(id: string, fullName: string, email: string) {
    this.id = id;
    this.fullName = fullName;
    this.email = email;
  }
}
