import {
  IsArray,
  ArrayNotEmpty,
  ArrayUnique,
  ArrayMaxSize,
  IsUUID,
} from 'class-validator';
import { Expose } from 'class-transformer';

/**
 * AssignZoneDevicesDto (ZNA-001 / UC-94) — body gán thiết bị vào khu vực.
 *
 * `PATCH /api/v1/zones/:id/devices` — `zone_id` lấy từ path, CỐ Ý không khai trong body
 * (tránh 2 nguồn sự thật). Không khai `room_id`/toạ độ hay bất kỳ field nào của module `iot`.
 *
 * `@ArrayMaxSize(50)` là ràng buộc ARCH-02: gán all-or-nothing chạy trong 1 transaction, lô
 * quá lớn sẽ kéo dài transaction > 2s.
 *
 * ⚠ `@ArrayUnique()` BẮT BUỘC — chống `404` báo SAI: nếu cho phép `[A, A, B]` lọt xuống
 * service thì `findAssignableByIds` dùng SQL `In()` sẽ TỰ KHỬ TRÙNG và chỉ trả 2 bản ghi;
 * code kiểm "id thiếu" theo số lượng sẽ kết luận có id không tồn tại và ném
 * `IOT_DEVICE_NOT_FOUND` dù cả hai thiết bị đều đang tồn tại. Đây là lớp chặn thứ nhất; lớp
 * thứ hai là service xác định id thiếu bằng HIỆU TẬP HỢP (xem `ZonesService.assignDevices`).
 */
export class AssignZoneDevicesDto {
  @Expose({ name: 'device_ids' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  deviceIds: string[];
}
