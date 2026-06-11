export class ScheduleRangeDto {
  view: string;
  from: string;
  to: string;
  timezone: string;

  constructor(data: ScheduleRangeDto) {
    this.view = data.view;
    this.from = data.from;
    this.to = data.to;
    this.timezone = data.timezone;
  }
}
