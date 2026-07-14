import {
  IsOptional,
  IsEnum,
  IsUUID,
  IsString,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  EquipmentType,
  AssetStatus,
  HealthStatus,
} from '../entities/equipment.entity.js';

/**
 * UC-64 — Query lọc / tìm kiếm kho thiết bị (GET /api/v1/equipments).
 *
 * Tất cả filter optional, kết hợp AND. sortBy dùng allowlist @IsIn (chống inject
 * field); service map sang cột thật qua SORT_MAP. Read-only.
 */
export class ListEquipmentsQueryDto {
  @IsOptional()
  @IsEnum(EquipmentType, {
    message:
      'equipmentType khong hop le. Gia tri: camera, microphone, display, speaker, capture_agent, sensor, other',
  })
  equipmentType?: EquipmentType;

  @IsOptional()
  @IsEnum(AssetStatus, {
    message:
      'assetStatus khong hop le. Gia tri: available, assigned, retired, lost, maintenance',
  })
  assetStatus?: AssetStatus;

  @IsOptional()
  @IsEnum(HealthStatus, {
    message:
      'healthStatus khong hop le. Gia tri: healthy, warning, faulty, offline, unknown',
  })
  healthStatus?: HealthStatus;

  @IsOptional()
  @IsUUID('4', { message: 'currentRoomId phai la dinh dang UUID' })
  currentRoomId?: string;

  @IsOptional()
  @IsString({ message: 'search phai la chuoi ky tu' })
  search?: string;

  @IsOptional()
  @IsIn(
    [
      'equipmentCode',
      'equipmentName',
      'equipmentType',
      'assetStatus',
      'healthStatus',
      'createdAt',
    ],
    {
      message:
        'sortBy chi duoc la equipmentCode, equipmentName, equipmentType, assetStatus, healthStatus hoac createdAt',
    },
  )
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'sortOrder chi duoc la asc hoac desc' })
  sortOrder?: 'asc' | 'desc' = 'desc';

  @Type(() => Number)
  @IsOptional()
  @Min(1, { message: 'page phai lon hon hoac bang 1' })
  page?: number = 1;

  @Type(() => Number)
  @IsOptional()
  @Min(1, { message: 'limit phai lon hon hoac bang 1' })
  @Max(100, { message: 'limit khong duoc vuot qua 100' })
  limit?: number = 20;
}
