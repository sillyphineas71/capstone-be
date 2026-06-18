---
name: feat-list-iot-devices-plan
description: Kế hoạch hiện thực IOT-013 — GET /api/v1/iot-devices (list + filter + phân trang) và GET /:id (detail). Read-only.
category: iot
---

# Implementation Plan: Liệt kê & Xem chi tiết thiết bị IoT/Camera (IOT-013)

- **Feature ID**: IOT-013
- **Module**: `iot`
- **Spec Reference**: [spec.md](./spec.md)
- **Status**: Draft

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo plan.md cho IOT-013: ListIotDevicesQueryDto + service.findAll (QueryBuilder getManyAndCount) + service.findOne, controller @Get()/@Get(':id'), seed iot.device.read. Xác minh code thật (controller @Get + @Query route-level; toIotDeviceResponse; role VIEWER không tồn tại). | Toàn bộ file (bản đầu tiên) |

---

## 1. Technical Context

- **Framework**: NestJS 11 + PostgreSQL + TypeORM. nodenext → import `.js`.
- **Trạng thái module `iot`** (đã xác minh):
  - [iot-devices.controller.ts](../../../../src/modules/iot/controllers/iot-devices.controller.ts): có `@Post`/`@Patch` handler, `JwtAuthGuard` + `MockPermissionsGuard` (no-op) + `@Permissions(...)`. **Chưa có `@Get`**.
  - [iot-devices.service.ts](../../../../src/modules/iot/services/iot-devices.service.ts): có create/update/disable/enable/assignRoom/configure*. **Chưa có `findAll`/`findOne`** (read). Dùng `this.dataSource` (DataSource) → có thể tạo `this.dataSource.getRepository(IoTDeviceEntity).createQueryBuilder(...)`.
  - [iot-device-response.dto.ts](../../../../src/modules/iot/dto/iot-device-response.dto.ts): `toIotDeviceResponse()` snake_case + `maskSensitiveMetadata`.
  - [iot-device.entity.ts](../../../../src/modules/iot/entities/iot-device.entity.ts): `IoTDeviceType`, `IoTDeviceStatus`; cột `deviceName`/`deviceCode`/`status`/`deviceType`/`roomId`/`createdAt`.
- **Pattern list/query (đã xác minh)**: controller dùng `@Get()` + `@Query() dto: XxxQueryDto` + route-level `@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))` (vd [meetings.controller.ts](../../../../src/modules/meetings/controllers/meetings.controller.ts)). `@HttpCode(HttpStatus.OK)` là tùy chọn (GET mặc định 200).
- **Phân trang**: KHÔNG có DTO/util chung → tạo `ListIotDevicesQueryDto` cục bộ trong module iot. `meta` camelCase `{ page, limit, total, totalPages }`; `data[]` snake_case.
- **Role (đã xác minh)**: VIEWER **KHÔNG tồn tại**. Roles thật trong seeds: `ADMIN`, `MANAGER`, `EMPLOYEE`, `ROOM_ADMIN` → seed `iot.device.read` cho `ADMIN`, `MANAGER`.
- KHÔNG sửa entity/schema; read-only nên KHÔNG audit.

---

## 2. Danh sách thay đổi (file)

| Loại | File | Nội dung |
|---|---|---|
| **Mới** | `src/modules/iot/dto/list-iot-devices-query.dto.ts` | `ListIotDevicesQueryDto` (page/limit/status/device_type/room_id/search). |
| **Sửa** | `src/modules/iot/services/iot-devices.service.ts` | Thêm `findAll(query)` + `findOne(deviceId)`. |
| **Sửa** | `src/modules/iot/controllers/iot-devices.controller.ts` | Thêm `@Get()` (list) + `@Get(':id')` (detail). |
| **Mới (seed)** | `src/database/seeds/<timestamp>-SeedIotDeviceReadPermission.ts` | Seed `iot.device.read` (ADMIN/MANAGER). |
| **Mới (test)** | `src/modules/iot/services/iot-devices.service.spec.ts` (bổ sung) + `dto/list-iot-devices-query.dto.spec.ts` | Test findAll/findOne + DTO validate. |

> ⚠️ **Thứ tự route**: `@Get(':id')` phải đặt SAU `@Get()` và sau các route tĩnh; `:id` đã có `ParseUUIDPipe` nên `GET /iot-devices/abc` (không UUID) → 400, không nuốt nhầm route khác. Không có route con tĩnh trùng nên an toàn.

---

## 3. DTO — `ListIotDevicesQueryDto`

```ts
import { IsOptional, IsEnum, IsUUID, IsInt, Min, Max, MaxLength } from 'class-validator';
import { Expose, Type } from 'class-transformer';
import { IoTDeviceType, IoTDeviceStatus } from '../entities/iot-device.entity.js';

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
  @Max(100) // limit > 100 → 400 (NC-2)
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
```

- `@Type(() => Number)` để transform query string → number (query luôn là string).
- `device_type`/`room_id` map snake→camel qua `@Expose` (đồng bộ cách create/update DTO).
- Route pipe: `whitelist: true` (loại field lạ) + `transform: true`. **Không** `forbidNonWhitelisted` (query thừa chỉ cần bỏ qua, tránh vỡ khi FE thêm tham số tracking) — xem [NC-P1].

---

## 4. Service — `findAll` + `findOne`

### 4.1 `findAll(query: ListIotDevicesQueryDto)`

```text
1. const qb = dataSource.getRepository(IoTDeviceEntity).createQueryBuilder('d');
2. if (query.status) qb.andWhere('d.status = :status', { status });
3. if (query.deviceType) qb.andWhere('d.device_type = :dt', { dt });   // hoặc 'd.deviceType' theo alias TypeORM
4. if (query.roomId) qb.andWhere('d.room_id = :rid', { rid });
5. if (query.search) qb.andWhere('(d.device_name ILIKE :s OR d.device_code ILIKE :s)', { s: `%${query.search}%` });  // BOUND param — chống injection (NFR-002)
6. qb.orderBy('d.created_at', 'DESC').skip((page-1)*limit).take(limit);
7. const [items, total] = await qb.getManyAndCount();
8. return { items: items.map(toIotDeviceResponse), meta: { page, limit, total, totalPages: Math.ceil(total/limit) } };
```

- `getManyAndCount()` trả `[items, total]`: total là tổng khớp filter (không bị `skip/take` ảnh hưởng). `totalPages = ceil(total/limit)` (total=0 → 0).
- ⚠️ Tên cột trong `andWhere`: dùng đúng tên cột DB (`device_type`, `room_id`, `device_name`, `device_code`, `created_at`) hoặc property alias (`d.deviceType`...) — chốt khi code, kiểm bằng test. Search param **bound** (`:s`), KHÔNG nối chuỗi.

### 4.2 `findOne(deviceId: string)`

```text
1. const device = await dataSource.manager.findOne(IoTDeviceEntity, { where: { id: deviceId } });
2. if (!device) throw NotFoundException { code:'IOT_DEVICE_NOT_FOUND' }.
3. return toIotDeviceResponse(device).
```

- Read-only: KHÔNG transaction, KHÔNG audit.

---

## 5. Controller — 2 handler GET

```ts
import { Get, Query } from '@nestjs/common';

@Get()
@UseGuards(JwtAuthGuard, MockPermissionsGuard)
@Permissions('iot.device.read')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
async list(@Query() query: ListIotDevicesQueryDto) {
  const { items, meta } = await this.iotDevicesService.findAll(query);
  return { success: true, message: 'IoT devices retrieved successfully', data: items, meta };
}

@Get(':id')
@UseGuards(JwtAuthGuard, MockPermissionsGuard)
@Permissions('iot.device.read')
async detail(@Param('id', ParseUUIDPipe) id: string) {
  const data = await this.iotDevicesService.findOne(id);
  return { success: true, message: 'IoT device retrieved successfully', data };
}
```

- `findAll` đã map sang response DTO → controller chỉ wrap `{ success, message, data, meta }`.
- `findOne` đã trả `toIotDeviceResponse` → controller wrap `{ success, message, data }`.
- KHÔNG `@Body`. `iot.device.read` cho cả 2 (D-1).

---

## 6. Seed `iot.device.read`

File `src/database/seeds/<timestamp>-SeedIotDeviceReadPermission.ts` mirror seed hiện có:
- INSERT `('iot.device.read', 'Xem danh sách / chi tiết thiết bị IoT', 'iot', 'device_read', '<mô tả>', true)` + `ON CONFLICT DO NOTHING`.
- Gán `ADMIN`, `MANAGER` (VIEWER không tồn tại). Ghi chú seed-runner team-wide (NC-P2).

---

## 7. Error mapping (khớp spec §8.1)

| Tình huống | Cơ chế | HTTP | code |
|---|---|---|---|
| Sai page/limit/enum/uuid/search; limit>100 | ValidationPipe | 400 | VALIDATION_ERROR |
| Sai UUID `:id` (detail) | ParseUUIDPipe | 400 | VALIDATION_ERROR |
| Thiếu JWT | JwtAuthGuard | 401 | UNAUTHORIZED |
| Thiếu quyền | PermissionsGuard (thật) | 403 | FORBIDDEN |
| Detail không thấy | NotFoundException | 404 | IOT_DEVICE_NOT_FOUND |
| Lỗi DB | — | 500 | INTERNAL_SERVER_ERROR |

> List không bao giờ 404 (rỗng → 200 data:[], meta.total=0).

---

## 8. Testing (ENG-01 ≥ 80%)

### 8.1 Service `findAll` (mock QueryBuilder)
- **default**: không filter → andWhere không gọi cho filter; orderBy created_at DESC; skip(0) take(20); getManyAndCount→[items,total]; meta đúng. *(AC-001)*
- **filter status**: andWhere status gọi với giá trị (disabled hiển thị khi filter). *(AC-002)*
- **search**: andWhere `(device_name ILIKE :s OR device_code ILIKE :s)` với `s='%...%'` bound. *(AC-003)*
- **page 2**: skip((2-1)*20)=20. *(AC-004)*
- **empty**: getManyAndCount→[[],0]; meta.total=0, totalPages=0. *(EC-006)*

### 8.2 Service `findOne`
- **happy**: trả toIotDeviceResponse. *(AC-005)*
- **404**: findOne null → NotFoundException. *(AC-006/EC...)*

### 8.3 DTO validate (`list-iot-devices-query.dto.spec.ts`)
- limit>100 → invalid (400). *(EC-002)*
- status/device_type sai enum, room_id sai uuid, search>200 → invalid. *(EC-003)*
- default page=1/limit=20 khi không gửi; transform string→number.

- Mock QueryBuilder: `{ andWhere: jest.fn().mockReturnThis(), orderBy: ...ReturnThis(), skip: ...ReturnThis(), take: ...ReturnThis(), getManyAndCount: jest.fn() }`; `getRepository().createQueryBuilder()` trả mock. Coverage ≥80% code mới. Không e2e (NC-P3).

---

## 9. Ràng buộc & ngoài phạm vi (tự kiểm)

- KHÔNG sửa `IoTDeviceEntity`/schema; KHÔNG bảng mới (DATA-01).
- Read-only: KHÔNG transaction, KHÔNG audit, KHÔNG đổi dữ liệu.
- Search param **bound** (`:s`), KHÔNG nối chuỗi SQL (NFR-002).
- KHÔNG Prisma; import `.js`; mask metadata; KHÔNG trả secret.

---

## 10. [NEEDS CLARIFICATION]

- **[NC-P1] `forbidNonWhitelisted` cho query**: plan đề xuất chỉ `whitelist: true` (bỏ qua query thừa, không 400) để FE thêm tham số tracking không vỡ. Nếu muốn chặt như IOT-011 (`forbidNonWhitelisted: true` → 400 khi có query lạ) thì xác nhận.
- **[NC-P2] Seed-runner chưa wire** (team-wide, giống IOT-011/012).
- **[NC-P3] Phạm vi test**: unit service + DTO validate, không e2e — xác nhận.

---

## 11. Definition of Done

```text
[ ] ListIotDevicesQueryDto (page/limit min/max, enum/uuid/maxlength, transform number, @Expose snake)
[ ] service.findAll: QueryBuilder andWhere theo filter, search bound ILIKE, orderBy created_at DESC, getManyAndCount, meta camelCase
[ ] service.findOne: 404 IOT_DEVICE_NOT_FOUND, toIotDeviceResponse
[ ] controller @Get() + @Get(':id') (guard mock, iot.device.read, ParseUUIDPipe), KHÔNG audit
[ ] Seed iot.device.read (ADMIN/MANAGER)
[ ] Unit test findAll(5)/findOne(2)/DTO(≥3); coverage ≥ 80% code mới
[ ] Read-only, không đụng entity/schema, search bound param, mask metadata
[ ] Build/lint(per-file)/test xanh
```

---

> Trạng thái: **CHỜ REVIEW**. Đây là plan — chưa có tasks.md, chưa code. Dừng chờ Thiếu Chủ review.
