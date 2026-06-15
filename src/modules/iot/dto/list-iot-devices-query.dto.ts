import {
  IsOptional,
  IsEnum,
  IsUUID,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Expose, Type } from 'class-transformer';
import {
  IoTDeviceType,
  IoTDeviceStatus,
} from '../entities/iot-device.entity.js';

/**
 * ListIotDevicesQueryDto (IOT-013)
 *
 * Query cho GET /api/v1/iot-devices. page/limit phân trang (limit max 100 -> 400),
 * status/device_type/room_id/search là filter tùy chọn. Map snake_case (API) <->
 * camelCase (class) cho device_type/room_id qua @Expose.
 */
export class ListIotDevicesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsEnum(IoTDeviceStatus)
  status?: IoTDeviceStatus;

  @Expose({ name: 'device_type' })
  @IsOptional()
  @IsEnum(IoTDeviceType)
  deviceType?: IoTDeviceType;

  @Expose({ name: 'room_id' })
  @IsOptional()
  @IsUUID('4')
  roomId?: string;

  @IsOptional()
  @MaxLength(200)
  search?: string;
}
