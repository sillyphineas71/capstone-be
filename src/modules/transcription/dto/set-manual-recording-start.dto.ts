import { IsISO8601 } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * GA-35 (feat-speaker-tagging-live) — POST
 * /api/v1/meetings/:meetingId/recording/start-marker/manual.
 *
 * Dự phòng khi Host quên bấm "Bắt đầu ghi âm" trong lúc họp. NGOẠI LỆ DUY
 * NHẤT trong toàn bộ GIAI ĐOẠN 2+3 cho phép client cung cấp `event_time` —
 * mọi nơi khác server tự đóng dấu `now()` (quyết định #7, không tin đồng hồ
 * client). Ở đây bắt buộc phải nhận thời điểm quá khứ từ Host vì server
 * không thể tự biết lúc đó là mấy giờ. Được validate chặt ở service
 * (ERR-LIVE-002 không cho tương lai, ERR-LIVE-003 không cho cách xa giờ họp).
 */
export class SetManualRecordingStartDto {
  @ApiProperty({ description: 'Thời điểm thực tế bắt đầu ghi âm (ISO 8601)' })
  @IsISO8601()
  startedAt: string;
}
