import { Expose, Type } from 'class-transformer';
import { MinutesListItemDto } from './minutes-list-item.dto.js';

/**
 * MKM-MANUAL-01 T007: Response shape for GET /meeting-minutes/compare.
 * Contains both manual and AI minutes (or null for missing).
 */
export class CompareMinutesResponseDto {
  @Expose()
  @Type(() => MinutesListItemDto)
  manual: MinutesListItemDto | null;

  @Expose()
  @Type(() => MinutesListItemDto)
  ai: MinutesListItemDto | null;

  constructor(data: CompareMinutesResponseDto) {
    Object.assign(this, data);
  }
}
