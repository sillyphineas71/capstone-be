import {
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Expose } from 'class-transformer';

export const TRAFFIC_STATS_GROUP_BY = ['day', 'hour'] as const;
export type TrafficStatsGroupBy = (typeof TRAFFIC_STATS_GROUP_BY)[number];

/**
 * VehicleTrafficStatsQueryDto (VTS-001 / UC-114) — query GET /gate-access/admin/vehicle-traffic-stats.
 *
 * `from`/`to` BẮT BUỘC (SRS Normal Flow bước 2: "chọn khoảng thời gian" — không có nhánh
 * mặc định toàn bộ lịch sử). `zone_id` so trên cột `iot_device_events.zone_id` — hiện LUÔN
 * NULL cho vehicle event (residual spec §0.3), filter vẫn đúng schema, sẵn sàng khi Hải sửa.
 */
export class VehicleTrafficStatsQueryDto {
  @IsISO8601()
  @IsNotEmpty()
  from: string;

  @IsISO8601()
  @IsNotEmpty()
  to: string;

  @Expose({ name: 'zone_id' })
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @Expose({ name: 'vehicle_type' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleType?: string;

  @Expose({ name: 'group_by' })
  @IsOptional()
  @IsIn(TRAFFIC_STATS_GROUP_BY)
  groupBy?: TrafficStatsGroupBy;
}
