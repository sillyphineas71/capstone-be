import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * EQUIP-FAULT-LIFECYCLE-001 — Input xác nhận lỗi thiết bị (PATCH /equipments/:id/fault-confirmation).
 * confirmationNote là tùy chọn để sysadmin bổ sung ghi chú khi xác nhận lỗi.
 */
export class ConfirmEquipmentFaultDto {
  @IsOptional()
  @IsString({ message: 'confirmationNote phai la chuoi ky tu' })
  @MaxLength(2000, { message: 'confirmationNote toi da 2000 ky tu' })
  confirmationNote?: string;
}
