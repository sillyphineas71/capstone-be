import { RoomSuggestionItemDto } from './room-suggestion-item.dto.js';

/**
 * Response metadata cho room suggestion.
 */
export class RoomSuggestionMetaDto {
  /** Giới hạn kết quả tối đa (20) */
  resultLimit: number;

  /** Tổng số phòng đáp ứng tiêu chí (trước limit) */
  totalRoomsFound: number;
}

/**
 * Response wrapper cho GET /api/v1/scheduling/room-suggestions.
 */
export class RoomSuggestionResponseDto {
  data: RoomSuggestionItemDto[];
  meta: RoomSuggestionMetaDto;
}
