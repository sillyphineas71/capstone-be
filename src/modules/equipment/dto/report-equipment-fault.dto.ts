import {
  IsOptional,
  IsIn,
  IsString,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { HealthStatus, AssetStatus } from '../entities/equipment.entity.js';

/**
 * UC-62 — Input báo lỗi / chuyển bảo trì thiết bị (PATCH /equipments/:id/fault).
 *
 * Chỉ chiều "xấu đi": healthStatus chỉ nhận warning/faulty/offline;
 * assetStatus chỉ nhận maintenance. Chặn recovery (healthy/available) ngay ở DTO.
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
  @IsIn(['maintenance'], {
    message: 'assetStatus chi nhan maintenance qua endpoint bao loi',
  })
  assetStatus?: AssetStatus;

  @IsString({ message: 'issueNote phai la chuoi ky tu' })
  @IsNotEmpty({ message: 'issueNote khong duoc de trong' })
  @MaxLength(2000, { message: 'issueNote toi da 2000 ky tu' })
  issueNote: string;
}
