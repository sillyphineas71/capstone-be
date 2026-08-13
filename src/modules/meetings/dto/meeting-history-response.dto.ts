import { MeetingHistoryItemDto } from './meeting-history-item.dto.js';

export class MeetingHistoryResponseDto {
  items: MeetingHistoryItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;

  constructor(data: MeetingHistoryResponseDto) {
    this.items = data.items;
    this.total = data.total;
    this.page = data.page;
    this.limit = data.limit;
    this.totalPages = data.totalPages;
  }
}
