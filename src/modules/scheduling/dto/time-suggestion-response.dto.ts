import { TimeSuggestionItemDto } from './time-suggestion-item.dto.js';

export class TimeSuggestionMetaDto {
  searchRangeStart: string;
  searchRangeEnd: string;
  durationMinutes: number;
  totalCandidatesEvaluated: number;
  resultLimit: number;
}

/**
 * TimeSuggestionResponseDto — response body của
 * POST /api/v1/scheduling/time-suggestions (UC-SM-02).
 */
export class TimeSuggestionResponseDto {
  data: TimeSuggestionItemDto[];
  meta: TimeSuggestionMetaDto;
}
