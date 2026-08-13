import {
  IsOptional,
  IsIn,
  IsString,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { HealthStatus } from '../entities/equipment.entity.js';
import { ReportedAssetAction } from './report-equipment-fault.dto.js';

export type ResolvedAssetAction = ReportedAssetAction;

/**
 * EQUIP-FAULT-LIFECYCLE-001 — Input cập nhật thiết bị sau khi sửa xong (PATCH /equipments/:id/fault-resolution).
 * healthStatus bắt buộc: chỉ nhận healthy hoac warning.
 * assetStatus tùy chọn: active, maintenance, retired (service resolve qua resolveAssetAction).
 * resolutionNote bắt buộc: mô tả chi tiết đã xử lý/bảo trì những gì.
 */
export class ResolveEquipmentFaultDto {
  @IsIn(['healthy', 'warning'], {
    message: 'healthStatus bat buoc phai la healthy hoac warning',
  })
  healthStatus: HealthStatus;

  @IsOptional()
  @IsIn(['active', 'maintenance', 'retired'], {
    message: 'assetStatus chi nhan active, maintenance hoac retired',
  })
  assetStatus?: ResolvedAssetAction;

  @IsString({ message: 'resolutionNote phai la chuoi ky tu' })
  @IsNotEmpty({ message: 'resolutionNote khong duoc de trong' })
  @MaxLength(2000, { message: 'resolutionNote toi da 2000 ky tu' })
  resolutionNote: string;
}
