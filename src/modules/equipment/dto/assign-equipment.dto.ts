import {
  IsUUID,
  IsOptional,
  IsISO8601,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * UC-65 — Input gán thiết bị vào phòng họp (PATCH /equipments/:id/assignment).
 *
 * roomId bắt buộc. installedAt tùy chọn (mặc định now nếu không truyền, xử lý ở service).
 * KHÔNG nhận field khác — forbidNonWhitelisted reject.
 */
export class AssignEquipmentDto {
  @IsUUID('4', { message: 'roomId phai la dinh dang UUID' })
  roomId: string;

  @IsOptional()
  @IsISO8601({}, { message: 'installedAt phai la ngay ISO 8601' })
  installedAt?: string;

  @IsOptional()
  @IsString({ message: 'assignmentNote phai la chuoi ky tu' })
  @MaxLength(2000, { message: 'assignmentNote toi da 2000 ky tu' })
  assignmentNote?: string;
}
