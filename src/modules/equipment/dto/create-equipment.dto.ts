import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsObject,
  IsDateString,
  IsUUID,
  MaxLength,
  Length,
  Matches,
} from 'class-validator';
import { EquipmentType, HealthStatus } from '../entities/equipment.entity.js';

/**
 * UC-61 — Input đăng ký thiết bị họp mới (POST /api/v1/equipments).
 *
 * Chỉ nhận field trong danh sách chốt. Các field còn lại của entity
 * (iotDeviceId, assetStatus, assignedBy/assignedAt, lastIssue*, lastMaintenance*)
 * KHÔNG được nhận từ client — `forbidNonWhitelisted` sẽ reject nếu gửi.
 *
 * roomId/assignmentNote (tùy chọn): cho phép gán phòng ngay lúc đăng ký thay vì
 * phải tạo xong rồi gán riêng ở bước sau (PATCH .../assignment). Nếu gán, service
 * validate roomId TRƯỚC khi tạo (không tạo thiết bị "mồ côi" nếu gán thất bại).
 */
export class CreateEquipmentDto {
  @IsString({ message: 'equipmentName phai la chuoi ky tu' })
  @IsNotEmpty({ message: 'equipmentName khong duoc de trong' })
  @MaxLength(150, { message: 'equipmentName toi da 150 ky tu' })
  equipmentName: string;

  @IsEnum(EquipmentType, {
    message:
      'equipmentType khong hop le. Gia tri: camera, microphone, display, speaker, capture_agent, sensor, other',
  })
  equipmentType: EquipmentType;

  @IsString({ message: 'equipmentCode phai la chuoi ky tu' })
  @IsNotEmpty({ message: 'equipmentCode khong duoc de trong' })
  @Length(3, 80, { message: 'equipmentCode phai tu 3 den 80 ky tu' })
  @Matches(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, {
    message:
      'equipmentCode chi chap nhan ky tu A-Z, 0-9 va dau gach ngang (-), viet hoa',
  })
  @MaxLength(80, { message: 'equipmentCode toi da 80 ky tu' })
  equipmentCode: string;

  @IsOptional()
  @IsString({ message: 'serialNumber phai la chuoi ky tu' })
  @MaxLength(120, { message: 'serialNumber toi da 120 ky tu' })
  serialNumber?: string;

  @IsOptional()
  @IsString({ message: 'brand phai la chuoi ky tu' })
  @MaxLength(100, { message: 'brand toi da 100 ky tu' })
  brand?: string;

  @IsOptional()
  @IsString({ message: 'model phai la chuoi ky tu' })
  @MaxLength(100, { message: 'model toi da 100 ky tu' })
  model?: string;

  @IsOptional()
  @IsDateString(
    {},
    { message: 'purchaseDate phai la ngay hop le (YYYY-MM-DD)' },
  )
  purchaseDate?: string;

  @IsOptional()
  @IsObject({ message: 'specification phai la object' })
  specification?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(HealthStatus, {
    message:
      'healthStatus khong hop le. Gia tri: healthy, warning, faulty, offline, unknown',
  })
  healthStatus?: HealthStatus;

  @IsOptional()
  @IsUUID('4', { message: 'roomId phai la dinh dang UUID' })
  roomId?: string;

  @IsOptional()
  @IsString({ message: 'assignmentNote phai la chuoi ky tu' })
  @MaxLength(2000, { message: 'assignmentNote toi da 2000 ky tu' })
  assignmentNote?: string;
}
