import {
  GateAccessHistoryItemDto,
  GateAccessHistoryRow,
  toGateAccessHistoryItemDto,
} from './gate-access-history-item-response.dto.js';

/**
 * GateAccessHistoryDetailDto (GAH-001 / UC-117) — chi tiết 1 phiên, thêm `image_url` so với
 * list (SRS Normal Flow bước 5: "chọn xem chi tiết ... để xem thêm ảnh chụp").
 */
export class GateAccessHistoryDetailDto extends GateAccessHistoryItemDto {
  image_url: string | null;
}

export function toGateAccessHistoryDetailDto(
  row: GateAccessHistoryRow,
  includeUserId: boolean,
): GateAccessHistoryDetailDto {
  const item = toGateAccessHistoryItemDto(row, includeUserId);
  const imageUrl = row.metadata_json?.['imageUrl'];
  return {
    ...item,
    image_url: typeof imageUrl === 'string' ? imageUrl : null,
  };
}
