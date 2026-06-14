import { ScheduleEventDto } from './schedule-event.dto.js';
import { ScheduleRangeDto } from './schedule-range.dto.js';

export class ScheduleResponseDto {
  items: ScheduleEventDto[];
  range: ScheduleRangeDto;
  empty: boolean;

  constructor(data: {
    items: ScheduleEventDto[];
    range: ScheduleRangeDto;
    empty: boolean;
  }) {
    this.items = data.items;
    this.range = data.range;
    this.empty = data.empty;
  }
}
