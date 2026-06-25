# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Tạo mới research.md cho UC-SM-01 | Toàn bộ file |

---

# Research Document: UC-SM-01 — Xem danh sách phòng họp đề xuất

> **Phase 0 output** — Codebase analysis, technology decisions, and known risks.

## 1. Codebase Analysis

### 1.1 Module Scheduling hiện tại
- `src/modules/scheduling/` vừa được khởi tạo, chỉ có `scheduling.module.ts` rỗng (`@Module({})`).
- Chưa có controller, service, DTO, entity nào trong module này.

### 1.2 Module liên quan

#### `rooms` module
- `src/modules/rooms/entities/room.entity.ts`: RoomEntity với các field cần query — `roomCode`, `roomName`, `capacity`, `roomType`, `currentStatus`, `siteName`, `areaName`, `isActive`, `hasCamera`, `hasMicrophone`, `hasDisplay`, `allowRecording`, `deletedAt`.
- `src/modules/rooms/entities/room-booking.entity.ts`: RoomBookingEntity — `roomId`, `reservedStartTime`, `reservedEndTime`, `status` (PENDING, APPROVED, ACTIVE, COMPLETED, CANCELLED, RELEASED).
- `rooms.module.ts` exports `TypeOrmModule` (chỉ entity, không service).
- Pattern: dùng `TypeOrmModule.forFeature` trong module cần dùng thay vì import `RoomsModule` để tránh circular dependency.

#### `equipment` module
- `src/modules/equipment/entities/equipment.entity.ts`: EquipmentEntity — `equipmentType` (CAMERA, MICROPHONE, DISPLAY, SPEAKER, CAPTURE_AGENT, SENSOR, OTHER), `assetStatus` (AVAILABLE, ASSIGNED, RETIRED, LOST, MAINTENANCE), `healthStatus` (HEALTHY, WARNING, FAULTY, OFFLINE, UNKNOWN), `currentRoomId`, `deletedAt`.

### 1.3 Pattern Reference
- **Controller**: dùng `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions(...)`, `@CurrentUser()` decorator.
- **Service**: inject repository pattern, return typed response objects.
- **Validation**: `class-validator` + `ValidationPipe` với `whitelist: true`, `transform: true`, `forbidNonWhitelisted: true`.
- **Response**: `{ success: boolean, message: string, data: T, meta?: object }`.
- **Error**: exception filter chung, dùng `HttpException` hoặc custom exceptions.

### 1.4 Existing Similar Feature
- `GET /rooms/available` trong `MeetingsController` — đã có logic tìm phòng trống theo thời gian và capacity, nhưng chưa có equipment filter, sorting score, hay limit 20. Có thể tái sử dụng query pattern.

## 2. Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| ORM query strategy | TypeORM QueryBuilder | Cần join rooms + room_bookings + equipments với filter động; QueryBuilder cho phép xây dựng query linh hoạt theo params |
| Auth guard | `JwtAuthGuard` + `PermissionsGuard` | Pattern đã có sẵn trong codebase; permission `scheduling.suggest.rooms` đã được định nghĩa trong API contract |
| Validation | `class-validator` DTO với `ValidationPipe` | Pattern chuẩn của codebase; dùng `@Type(() => Date)` transform cho date params |
| Response format | `{ success, message, data }` | API convention chuẩn của dự án (AGENTS.md mục 8) |
| Module isolation | Dùng `TypeOrmModule.forFeature` cho RoomEntity, RoomBookingEntity, EquipmentEntity | Tránh circular dependency giữa scheduling, rooms, equipment modules |
| Score calculation | Simple scoring: `100 - (capacity - attendeeCount) / capacity * 100` | Không cần ML, chỉ cần heuristic đơn giản dựa trên độ vừa vặn sức chứa |
| Limit kết quả | 20 rooms `slice(0, 20)` sau sort | FR-025 — spec yêu cầu tối đa 20 phòng, không pagination |

## 3. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Không index trên `room_bookings.reserved_start_time`, `reserved_end_time` | Slow query khi có nhiều booking | Đảm bảo index đã tồn tại trong DB baseline; nếu chưa, thêm migration |
| Không index trên `equipments.current_room_id`, `equipment_type` | Slow equipment EXISTS subquery | Đảm bảo index hiện có (ix_equipments_current_room, ix_equipments_type) |
| Circular dependency giữa scheduling và rooms module | Module load failure | Dùng `TypeOrmModule.forFeature` thay vì import cả module |
| Concurrency: kết quả thay đổi giữa lúc query và lúc user đặt phòng | User đặt phòng không thành công | Spec đã xác định đây là snapshot; conflict cuối cùng check ở luồng tạo booking |
