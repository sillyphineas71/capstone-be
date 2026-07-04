export class PersonSummaryDto {
  id: string;
  fullName: string;
  email: string;

  constructor(data: PersonSummaryDto) {
    Object.assign(this, data);
  }
}
