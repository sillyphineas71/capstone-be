import {
  IsOptional,
  IsIn,
  IsString,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { HealthStatus } from '../entities/equipment.entity.js';

/**
 * Hanh dong nguoi dung chon o dropdown "Hanh dong" (FE EquipmentManagement.jsx).
 * Khong trung voi AssetStatus cua entity ('active' khong ton tai trong DB) —
 * service.reportFault se map 'active' -> AVAILABLE/ASSIGNED tuy currentRoomId.
 */
export type ReportedAssetAction = 'active' | 'maintenance' | 'retired';

/**
 * UC-62 — Input báo lỗi / chuyển bảo trì thiết bị (PATCH /equipments/:id/fault).
 *
 * healthStatus chỉ nhận warning/faulty/offline (chặn recovery ve healthy ngay o DTO).
 * assetStatus nhan active/maintenance/retired — service se resolve 'active' sang
 * trang thai that (available/assigned) va 'retired' sang AssetStatus.RETIRED.
 * Ràng buộc "ít nhất một status" được kiểm ở service (Phase A) → 422 FAULT_NO_CHANGE.
 */
export class ReportEquipmentFaultDto {
  @IsOptional()
  @IsIn(['warning', 'faulty', 'offline'], {
    message:
      'healthStatus chi nhan warning, faulty hoac offline (khong cho recovery)',
  })
  healthStatus?: HealthStatus;

  @IsOptional()
  @IsIn(['active', 'maintenance', 'retired'], {
    message: 'assetStatus chi nhan active, maintenance hoac retired',
  })
  assetStatus?: ReportedAssetAction;

  @IsString({ message: 'issueNote phai la chuoi ky tu' })
  @IsNotEmpty({ message: 'issueNote khong duoc de trong' })
  @MaxLength(2000, { message: 'issueNote toi da 2000 ky tu' })
  issueNote: string;
}
