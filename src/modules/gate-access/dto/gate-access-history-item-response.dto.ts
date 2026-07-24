/** Raw row shape trả về từ câu SQL self-join của `GateAccessHistoryService` (BASE_SELECT). */
export interface GateAccessHistoryRow {
  id: string;
  zone_id: string | null;
  zone_code: string | null;
  zone_name: string | null;
  user_id: string | null;
  plate_number: string | null;
  metadata_json: Record<string, unknown> | null;
  check_in_time: Date | null;
  check_out_time: Date | null;
  duration_seconds: number | null;
  session_status: 'completed' | 'incomplete';
}

/**
 * GateAccessHistoryItemDto (GAH-001 / UC-117) — 1 dòng = 1 PHIÊN (đúng POST-1 SRS: gồm cả
 * `check_in_time` VÀ `check_out_time` trong cùng 1 record). `user_id` CHỈ có ở route admin.
 */
export class GateAccessHistoryItemDto {
  id: string;
  zone_id: string | null;
  zone_code: string | null;
  zone_name: string | null;
  check_in_time: Date | null;
  check_out_time: Date | null;
  duration_seconds: number | null;
  plate_number: string | null;
  session_status: 'completed' | 'incomplete';
  user_id?: string;
}

export function toGateAccessHistoryItemDto(
  row: GateAccessHistoryRow,
  includeUserId: boolean,
): GateAccessHistoryItemDto {
  const dto: GateAccessHistoryItemDto = {
    id: row.id,
    zone_id: row.zone_id,
    zone_code: row.zone_code,
    zone_name: row.zone_name,
    check_in_time: row.check_in_time,
    check_out_time: row.check_out_time,
    duration_seconds: row.duration_seconds,
    plate_number: row.plate_number,
    session_status: row.session_status,
  };
  if (includeUserId) {
    dto.user_id = row.user_id ?? undefined;
  }
  return dto;
}
