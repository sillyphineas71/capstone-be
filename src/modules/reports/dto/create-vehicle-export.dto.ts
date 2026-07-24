import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * VehicleExportFiltersDto — lọc theo loại xe/cổng (UC-128 §5.2).
 *
 * §0.3 spec: filter zoneId chỉ có tác dụng khi content IN ('traffic_stats','both') —
 * quyết định "áp dụng hay bỏ qua" nằm ở tầng data service, KHÔNG ở DTO.
 */
export class VehicleExportFiltersDto {
  @IsOptional()
  @IsString()
  vehicleType?: string;

  @IsOptional()
  @IsUUID()
  zoneId?: string;
}

/**
 * CreateVehicleExportDto — DTO tạo job xuất báo cáo phương tiện (UC-128).
 */
export class CreateVehicleExportDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsIn(['pdf', 'xlsx'])
  format: string;

  @IsIn(['registrations', 'traffic_stats', 'both'])
  content: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => VehicleExportFiltersDto)
  filters?: VehicleExportFiltersDto;
}
