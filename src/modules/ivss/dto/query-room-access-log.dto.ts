import { IsOptional, Matches } from 'class-validator';

/**
 * QueryRoomAccessLogDto (RAL-001 / Màn 2) — query cho
 * GET /ivss/rooms/:roomId/access-log.
 *
 * `date` dạng YYYY-MM-DD; thiếu → service tự lấy hôm nay. Dùng @Matches thay
 * @IsDateString vì chỉ chấp nhận ngày thuần (không nhận ISO có giờ/offset) —
 * biên ngày được tính trong SQL bằng `$2::date` .. `+ interval '1 day'`.
 */
export class QueryRoomAccessLogDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date phải theo định dạng YYYY-MM-DD',
  })
  date?: string;
}
