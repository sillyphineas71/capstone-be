# Implementation Plan: Register Camera/IoT Device

- **Feature ID**: IOT-001
- **Module**: `iot`
- **Spec Reference**: [spec.md](./spec.md)
- **Status**: Draft

## 1. Technical Context

- **Framework**: NestJS + PostgreSQL + TypeORM.
- **Current State**: Module `iot` mới chỉ có file `iot.module.ts` cơ bản. Chưa có Entity `IotDevice`. 
- **Equipment Relation**: Team đã chốt xóa liên kết giữa `equipments` và `iot_devices` trong MVP hiện tại. UC này KHÔNG xử lý `equipment_id` hay liên kết đến bảng `equipments`.
- **Audit Logging**: Bảng `audit_logs` đã được sử dụng trong dự án (ví dụ qua raw query như `AuthAuditRepository`). UC này sẽ tạo `IotAuditRepository` tương tự để ghi log hành động tạo thiết bị vào bảng `audit_logs`.

## 2. Data Model / Entity

Tạo Entity `IotDevice` trong `src/modules/iot/entities/iot-device.entity.ts`. TypeORM entity dùng `camelCase`, nhưng ánh xạ xuống Database bằng `snake_case` qua `name` option.

**Lưu ý**: Cột `device_type` sẽ sử dụng kiểu `varchar` thay vì PostgreSQL enum để tránh phức tạp trong việc quản lý enum type qua migration.

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum IotDeviceType {
  DOOR_FACE_TERMINAL = 'door_face_terminal',
  IP_ROOM_CAMERA = 'ip_room_camera',
  ROOM_CAMERA = 'room_camera',
  MICROPHONE = 'microphone',
  CAPTURE_AGENT = 'capture_agent',
  OCCUPANCY_SENSOR = 'occupancy_sensor',
  DISPLAY = 'display',
  OTHER = 'other',
}

@Entity('iot_devices')
export class IotDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_name', type: 'varchar', length: 255 })
  deviceName: string;

  @Column({ name: 'device_code', type: 'varchar' })
  // Lưu ý: unique constraint sẽ được khai báo rõ trong Migration
  deviceCode: string;

  // Dùng varchar thay vì enum trong DB
  @Column({ name: 'device_type', type: 'varchar', length: 50 })
  deviceType: IotDeviceType;

  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress: string | null;

  @Column({ name: 'mac_address', type: 'varchar', nullable: true })
  macAddress: string | null;

  @Column({ type: 'varchar', default: 'offline' })
  status: string;

  @Column({ name: 'health_status', type: 'varchar', default: 'unknown' })
  healthStatus: string;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, any> | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
```

## 3. API Contract & Mapping (DTO)

**Endpoint**: `POST /api/v1/iot-devices`

### 3.1. Create DTO (`src/modules/iot/dto/create-iot-device.dto.ts`)

API Contract sử dụng `snake_case`, trong khi Class/Entity sử dụng `camelCase`. Chúng ta dùng `@Expose({ name: 'snake_case_name' })` từ `class-transformer`.

*Lưu ý về MAC Normalization*: MAC address sẽ được transform thay thế ký tự `-` thành `:` và chuyển thành in hoa trước khi validation. E.g. `00-1a-2b-3c-4d-5e` -> `00:1A:2B:3C:4D:5E`. Check duplicate sẽ dùng giá trị đã chuẩn hóa này.

```typescript
import { IsString, IsNotEmpty, MaxLength, IsEnum, IsOptional, IsIP, IsMACAddress, IsObject } from 'class-validator';
import { Expose, Transform } from 'class-transformer';
import { IotDeviceType } from '../entities/iot-device.entity';

export class CreateIotDeviceDto {
  @Expose({ name: 'device_name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceName: string;

  @Expose({ name: 'device_code' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
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
  @Transform(({ value }) => typeof value === 'string' ? value.trim().replace(/-/g, ':').toUpperCase() : value)
  @IsMACAddress()
  macAddress?: string;

  @Expose({ name: 'metadata_json' })
  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, any>;
}
```

### 3.2. Response Mapping & Response DTO

Để trả về đúng format `snake_case` và thực hiện Masking, ta sẽ tạo một function mapper `toIotDeviceResponse(entity: IotDevice)` (hoặc sử dụng class có Constructor phù hợp) để convert thủ công. Không phụ thuộc vào class-serializer interceptor ngầm định.

**Logic Recursive Masking**: Tạo một utility function đệ quy duyệt toàn bộ các key trong object `metadata_json`. Bất cứ key nào (case-insensitive) chứa các từ `secret`, `token`, hoặc `password` (ví dụ `secret_token`, `callbackToken`, `rtsp_password`) thì lập tức mask giá trị thành `"***"`.

```typescript
export class IotDeviceResponseDto {
  id: string;
  device_name: string;
  device_code: string;
  device_type: string;
  ip_address: string | null;
  mac_address: string | null;
  status: string;
  health_status: string;
  last_seen_at: Date | null;
  metadata_json: Record<string, any> | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

// Hàm Mapper
export function toIotDeviceResponse(entity: IotDevice): IotDeviceResponseDto {
  return {
    id: entity.id,
    device_name: entity.deviceName,
    device_code: entity.deviceCode,
    device_type: entity.deviceType,
    ip_address: entity.ipAddress,
    mac_address: entity.macAddress,
    status: entity.status,
    health_status: entity.healthStatus,
    last_seen_at: entity.lastSeenAt,
    metadata_json: maskSensitiveMetadata(entity.metadataJson),
    created_by: entity.createdBy,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}
```

## 4. Permission / Security

### 4.1. Authorization
- Endpoint dùng JWT Auth Guard.
- Yêu cầu quyền `iot_devices:create` qua decorator permission của framework (VD: `@Permissions('iot_devices:create')`). Không hard-code `Role.Admin` trong code.

### 4.2. Security Rules (Masking Secrets)
- Logic `maskSensitiveMetadata(json)` phải được gọi trước khi trả về Response cho client (đã mô tả trong 3.2).
- Nếu service bắt buộc phải log thông tin thiết bị (qua `Logger`), nó cũng phải gọi hàm masking này trước khi log raw `metadata_json`. Tránh lộ lọt credentials ra file/console.

## 5. Transaction & Audit Strategy

Vì UC này cần thực hiện 2 thao tác ghi vào Database: insert record vào bảng `iot_devices` và insert record vào bảng `audit_logs` (thông qua `IotAuditRepository`), bắt buộc **phải bọc trong một TypeORM Transaction** (sử dụng QueryRunner hoặc EntityManager) để đảm bảo tính toàn vẹn dữ liệu.

Flow thực thi:
1. Mở Transaction.
2. Lưu bản ghi `IotDevice`.
3. Gọi `IotAuditRepository.logDeviceCreation(...)` (truyền kèm EntityManager của transaction) để insert vào `audit_logs` với các params:
   - `action_type`: `'create'`
   - `entity_type`: `'iot_devices'`
   - `entity_id`: `iotDevice.id`
4. Commit Transaction (Rollback nếu xảy ra lỗi).

## 6. Migration Strategy

Bắt buộc tạo một TypeORM Migration explicit.
File migration sẽ bao gồm các cột tương ứng phục vụ UC này:
1. `CREATE TABLE iot_devices (...)` với các cột:
   - `id` (uuid, PK)
   - `device_name` (varchar)
   - `device_code` (varchar)
   - `device_type` (varchar(50))
   - `ip_address` (varchar, null)
   - `mac_address` (varchar, null)
   - `status` (varchar)
   - `health_status` (varchar)
   - `last_seen_at` (timestamptz, null)
   - `metadata_json` (jsonb, null)
   - `created_by` (uuid, null)
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)
   (Tuyệt đối KHÔNG có `equipment_id` hay bất kỳ liên kết Foreign Key nào sang bảng `equipments`).
2. `ALTER TABLE iot_devices ADD CONSTRAINT UQ_device_code UNIQUE (device_code);`
3. `CREATE UNIQUE INDEX IDX_mac_address_partial ON iot_devices (mac_address) WHERE mac_address IS NOT NULL;`

Việc tạo table, constraint và index phải làm trong raw SQL hoặc query runner API của migration script.

## 7. Test Strategy

Cần viết Unit Test cho `IotDevicesService` và Mapper:
- **MAC Normalization**: Kiểm tra chuỗi `00-1a-2b-3c-4d-5e` có được normalize thành `00:1A:2B:3C:4D:5E` và đi qua validator `IsMACAddress` an toàn hay không. Trùng lặp check trên bản in hoa này -> Conflict.
- **Recursive Masking**: Kiểm tra hàm `maskSensitiveMetadata`: 
  - Input: `{"camera": {"callbackToken": "123", "normalKey": "value"}, "rtsp_password": "456"}`
  - Output: `{"camera": {"callbackToken": "***", "normalKey": "value"}, "rtsp_password": "***"}` (Case-insensitive check).
- **Happy Path**: Lưu thành công, verify default status, trả về DTO đúng snake_case.
- **Validation Error**: Payload thiếu trường bắt buộc, sai IP format.
- **Authorization**: Giả lập user không có quyền -> 403.

## 8. Risks / Open Questions

- **Migration Naming**: Cần follow đúng format đặt tên migration của NestJS TypeORM (VD: timestamp-create-iot-devices.ts).
- **Audit Transaction Integration**: Vì `AuthAuditRepository` hiện tại đang dùng `DataSource` để query thô, `IotAuditRepository` cần nhận vào `EntityManager` trong param của hàm log để có thể thực thi chung trong cùng một Transaction context với thao tác tạo thiết bị.
