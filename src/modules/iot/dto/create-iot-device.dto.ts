import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsEnum,
  IsOptional,
  IsIP,
  IsMACAddress,
  IsObject,
} from 'class-validator';
import { Expose, Transform } from 'class-transformer';
import { IotDeviceType } from '../entities/iot-device.entity';
import { normalizeMacAddress } from '../../../common/utils/mac.util';

export class CreateIotDeviceDto {
  @Expose({ name: 'device_name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceName: string;

  @Expose({ name: 'device_code' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  deviceCode: string;

  @Expose({ name: 'device_type' })
  @IsEnum(IotDeviceType)
  deviceType: IotDeviceType;

  @Expose({ name: 'ip_address' })
  @IsOptional()
  @IsIP()
  ipAddress?: string;

  @Expose({ name: 'mac_address' })
  @IsOptional()
  @Transform(({ value }) => normalizeMacAddress(value))
  @IsMACAddress()
  macAddress?: string;

  @Expose({ name: 'metadata_json' })
  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, any>;
}
