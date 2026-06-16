# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Hoàn thành implement toàn bộ code theo plan | Toàn bộ file |
| 2026-06-16 | Tạo mới plan.md cho UC-SM-01 | Toàn bộ file |

---

# Implementation Plan: UC-SM-01/UC-50 — Xem danh sách phòng họp đề xuất

> **Feature ID**: UC-SM-01 (tương ứng UC-50)
> **Module**: `scheduling`
> **Endpoint**: `GET /api/v1/scheduling/room-suggestions`
> **Permission**: `scheduling.suggest.rooms`
> **Branch**: `011-room-suggestion`
> **Spec**: `spec/features/scheduler/feat-scheduling-room-suggestions/spec.md`
> **Research**: `spec/features/scheduler/feat-scheduling-room-suggestions/research.md`
> **Data Model**: `spec/features/scheduler/feat-scheduling-room-suggestions/data-model.md`
> **API Contract**: `spec/features/scheduler/feat-scheduling-room-suggestions/contracts/room-suggestion-api.md`
> **Quickstart**: `spec/features/scheduler/feat-scheduling-room-suggestions/quickstart.md`

---

## 1. Feature Summary

UC-SM-01 cung cấp API `GET /api/v1/scheduling/room-suggestions` — gợi ý danh sách phòng họp phù hợp dựa trên thời gian, sức chứa, thiết bị yêu cầu và các tiêu chí phụ (vị trí, loại phòng, recording). Feature là read-only suggestion API: không tạo booking, không giữ chỗ, không approve.

**Phạm vi**: Chỉ Scheduling Management module. Kết quả là snapshot thời gian thực — nếu hai user cùng thấy một phòng, người xác nhận booking trước sẽ giữ được phòng (conflict check ở luồng tạo booking).

---

## 2. Technical Context

### 2.1 Tech Stack
| Stack | Version / Chi tiết |
|---|---|
| Framework | NestJS (Node.js LTS) |
| Language | TypeScript (strict) |
| ORM | TypeORM với QueryBuilder |
| Database | PostgreSQL |
| Auth | JWT Bearer token |
| Validation | `class-validator` + `ValidationPipe` |
| Testing | Jest |

### 2.2 Module hiện tại
- `scheduling` module: chỉ có `scheduling.module.ts` rỗng → cần scaffold: controller, service, DTO.
- `rooms` module: có `RoomEntity`, `RoomBookingEntity`, `RoomsModule` exports `TypeOrmModule`.
- `equipment` module: có `EquipmentEntity`.

### 2.3 Pattern sử dụng
- Guard: `JwtAuthGuard` + `PermissionsGuard` với `@RequirePermissions('scheduling.suggest.rooms')`
- Response: `{ success, message, data, meta }`
- QueryBuilder: dùng TypeORM QueryBuilder cho filter động
- Module isolation: dùng `TypeOrmModule.forFeature` thay vì import module đầy đủ (tránh circular dependency)

---

## 3. Scope Confirmation

### 3.1 In Scope
- `GET /api/v1/scheduling/room-suggestions` endpoint
- Query params: startTime, endTime, attendeeCount, roomType, siteName, areaName, allowRecording, hasCamera, hasMicrophone, hasDisplay
- Validation input (time, attendeeCount, duration ≤ 24h)
- Auth guard + permission check
- Filter rooms: active, đủ capacity, không maintenance/inactive, không overlap booking
- Equipment filter: EXISTS subquery với `asset_status='assigned'` và `health_status='healthy'`
- Sort: capacity diff ASC → room_name ASC → room_code ASC
- Limit: 20 rooms (không pagination)
- Score calculation heuristic
- matchedFeatures và warnings
- Unit tests: DTO validation, service, controller

### 3.2 Out of Scope (confirmed từ spec)
- Không tạo meeting/meeting_request/room_booking
- Không giữ chỗ / lock phòng
- Không gửi notification
- Không check participant schedule
- Không recurring meeting
- Không thêm bảng DB mới
- Không gợi ý thời gian thay thế
- Không pagination (limit 20 cố định)
- Không buffer time (back-to-back booking OK)

---

## 4. Data Model Impact

### 4.1 Không thay đổi schema
- **Không thêm bảng mới** — database v3.2 Compact (39 bảng) đã đủ.
- **Không thêm cột mới** — dùng `rooms.has_camera`, `rooms.has_microphone`, `rooms.has_display` và `equipments` table cho EXISTS check.

### 4.2 Entities đọc
| Entity | Mục đích | Fields chính |
|---|---|---|
| `RoomEntity` | Thông tin phòng, filter | `isActive`, `deletedAt`, `capacity`, `currentStatus`, `roomType`, `siteName`, `areaName`, `allowRecording` |
| `RoomBookingEntity` | Kiểm tra overlap | `roomId`, `reservedStartTime`, `reservedEndTime`, `status` |
| `EquipmentEntity` | EXISTS check cho thiết bị | `currentRoomId`, `equipmentType`, `assetStatus`, `healthStatus`, `deletedAt` |

### 4.3 Index đã có
- `rooms`: `ix_rooms_capacity`, `ix_rooms_status`, `ix_rooms_type`, `ix_rooms_active`
- `room_bookings`: cần index trên `(room_id, reserved_start_time, reserved_end_time, status)` — xác nhận index tồn tại
- `equipments`: `ix_equipments_current_room`, `ix_equipments_type`

---

## 5. API / Contract Plan

### 5.1 Endpoint
`GET /api/v1/scheduling/room-suggestions`

Chi tiết request/response: xem `contracts/room-suggestion-api.md`

### 5.2 Controller methods
- `SchedulingController.getRoomSuggestions(@Query() dto: RoomSuggestionQueryDto, @Req() request)`
- Dùng `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('scheduling.suggest.rooms')`
- `@UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))`

### 5.3 DTOs cần tạo

| DTO | Path | Notes |
|---|---|---|
| `RoomSuggestionQueryDto` | `dto/room-suggestion-query.dto.ts` | Tất cả fields optional except startTime, endTime, attendeeCount |
| `RoomSuggestionResponseDto` | `dto/room-suggestion-response.dto.ts` | RoomItem[] response |
| `RoomSuggestionItemDto` | `dto/room-suggestion-item.dto.ts` | roomId, roomCode, roomName, capacity, score, available, matchedFeatures, warnings |

---

## 6. Authorization Plan

| Layer | Mechanism | Notes |
|---|---|---|
| Authentication | `JwtAuthGuard` | Kiểm tra token hợp lệ |
| Authorization | `PermissionsGuard` + `@RequirePermissions('scheduling.suggest.rooms')` | Permission `scheduling.suggest.rooms` cho phép tất cả authenticated roles (INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN) |
| User ID | `@Req() request` hoặc `@CurrentUser()` | Chỉ dùng để xác thực, không dùng trong business logic |
| Audit | Optional — read-only action | Log error nếu cần, không ghi audit log cho từng request |

---

## 7. Business Logic Plan

### 7.1 Flow Sequence

```
Request → Validation → Auth → QueryBuilder → Filter → Sort → Limit → Response
```

1. **Validate input** — DTO validation pipe kiểm tra startTime, endTime, attendeeCount
2. **Auth** — JwtAuthGuard + PermissionsGuard
3. **Query active rooms** — is_active=true, deleted_at IS NULL, capacity >= attendeeCount, current_status NOT IN (maintenance, inactive)
4. **Apply optional filters** — roomType, siteName, areaName, allowRecording
5. **Exclude rooms with booking overlap** — NOT EXISTS subquery trên room_bookings
6. **Apply equipment EXISTS filters** — nếu hasCamera/hasMicrophone/hasDisplay = true
7. **Sort** — capacity - attendeeCount ASC → room_name ASC → room_code ASC
8. **Limit** — slice 20 rooms đầu
9. **Calculate score & matchedFeatures** — cho từng room trong kết quả
10. **Return response**

### 7.2 Service Methods

| Method | Input | Output | Notes |
|---|---|---|---|
| `getRoomSuggestions(dto: RoomSuggestionQueryDto)` | Query DTO | `RoomSuggestionItemDto[]` | Core business logic — tất cả filter/sort/limit |
| `calculateScore(capacity, attendeeCount)` | capacity, attendeeCount | number | Heuristic: `max(0, 100 - (diff/capacity)*100)` |
| `buildMatchedFeatures(roomId, equipmentTypes)` | roomId, yêu cầu equipment | string[] | Query equipments table cho từng room |
| `buildWarnings(matchedFeatures, requestedFeatures)` | matched, requested | string[] | So sánh yêu cầu vs thực tế |

### 7.3 Transaction
- Không cần transaction — đây là read-only query.
- Dùng `@EntityManager` hoặc repository pattern.

---

## 8. Validation Plan

### 8.1 DTO Validation Rules (class-validator)

| Field | Decorators | Value |
|---|---|---|
| `startTime` | `@IsNotEmpty()`, `@IsISO8601({ strict: true })` | Bắt buộc, ISO-8601 |
| `endTime` | `@IsNotEmpty()`, `@IsISO8601({ strict: true })` | Bắt buộc, ISO-8601 |
| `attendeeCount` | `@IsNotEmpty()`, `@IsInt()`, `@Min(1)`, `@Type(() => Number)` | Bắt buộc, integer >= 1 |
| `roomType` | `@IsOptional()`, `@IsEnum(RoomType)` | Optional |
| `siteName` | `@IsOptional()`, `@IsString()` | Optional |
| `areaName` | `@IsOptional()`, `@IsString()` | Optional |
| `allowRecording` | `@IsOptional()`, `@IsBoolean()`, `@Transform(...)` | Optional boolean |
| `hasCamera` | `@IsOptional()`, `@IsBoolean()`, `@Transform(...)` | Optional boolean |
| `hasMicrophone` | `@IsOptional()`, `@IsBoolean()`, `@Transform(...)` | Optional boolean |
| `hasDisplay` | `@IsOptional()`, `@IsBoolean()`, `@Transform(...)` | Optional boolean |

### 8.2 Custom Validation (trong service)

| Validation | Logic | Error code |
|---|---|---|
| `endTime > startTime` | `new Date(endTime) <= new Date(startTime)` → reject | `SCHEDULING_DURATION_TOO_LONG` (nếu có message "Thời lượng ...") |
| `endTime - startTime <= 24h` | diff in ms > 24*60*60*1000 → reject | `SCHEDULING_DURATION_TOO_LONG` |
| `startTime >= now()` | past check | `VALIDATION_ERROR` |

---

## 9. Error Handling Plan

| Error | HTTP Status | Error Code | Xử lý |
|---|---|---|---|
| Thiếu/malformed startTime/endTime | 422 | `VALIDATION_ERROR` | ValidationPipe trả lỗi |
| endTime <= startTime hoặc > 24h | 422 | `SCHEDULING_DURATION_TOO_LONG` | Custom validator hoặc service business exception |
| startTime trong quá khứ | 422 | `VALIDATION_ERROR` | Service kiểm tra và throw BadRequestException |
| attendeeCount <= 0 | 422 | `VALIDATION_ERROR` | ValidationPipe với @Min(1) |
| Unauthenticated | 401 | `TOKEN_EXPIRED` | JwtAuthGuard |
| Forbidden (thiếu permission) | 403 | `PERMISSION_DENIED` | PermissionsGuard |
| Không có phòng phù hợp | 200 | — (success) | Trả `data: []` với message |
| Lỗi server | 500 | `INTERNAL_ERROR` | Exception filter |

---

## 10. Testing Strategy

### 10.1 Unit Tests

| File | Test scope | Cases |
|---|---|---|
| `room-suggestion-query.dto.spec.ts` | DTO validation | 8 cases: valid input, missing fields, invalid types, boundary values |
| `scheduling.service.spec.ts` | Service logic | 10+ cases: happy path, all optional filters, empty result, overlap exclusion, equipment filter EXISTS, sort order, limit, score calculation |
| `scheduling.controller.spec.ts` | Controller | 6 cases: success response structure, guards applied, error passthrough |

### 10.2 Integration Tests (optional — phạm vi sau)
- End-to-end: request → response với database thật hoặc mock
- Auth flow: token hợp lệ/không hợp lệ

### 10.3 Test Data
- Seed rooms with various capacities, statuses, and equipment
- Seed bookings for overlap scenarios
- Seed equipments with different asset/health statuses

---

## 11. Implementation Phases

### Phase 1: Foundation — Scheduling Module Setup
| Task | File | Description |
|---|---|---|
| T1 | `scheduling.module.ts` | Cập nhật SchedulingModule: import TypeOrmModule.forFeature([RoomEntity, RoomBookingEntity, EquipmentEntity]), register SchedulingController, SchedulingService |
| T2 | `scheduling.controller.ts` | Tạo SchedulingController với endpoint GET /scheduling/room-suggestions |
| T3 | `scheduling.service.ts` | Tạo SchedulingService với method getRoomSuggestions |

### Phase 2: DTOs & Validation
| Task | File | Description |
|---|---|---|
| T4 | `dto/room-suggestion-query.dto.ts` | RoomSuggestionQueryDto với decorators validation |
| T5 | `dto/room-suggestion-response.dto.ts` | RoomSuggestionResponseDto và RoomSuggestionItemDto |
| T6 | `room-suggestion-query.dto.spec.ts` | Unit test cho DTO validation |

### Phase 3: Business Logic Implementation
| Task | File | Description |
|---|---|---|
| T7 | `scheduling.service.ts` | Implement getRoomSuggestions: QueryBuilder + filters + equipment EXISTS |
| T8 | `scheduling.service.ts` | Implement score calculation, matchedFeatures, warnings |
| T9 | `scheduling.service.spec.ts` | Unit test cho service (core logic) |

### Phase 4: Controller & Integration
| Task | File | Description |
|---|---|---|
| T10 | `scheduling.controller.ts` | Hoàn thiện controller: guards, response format |
| T11 | `scheduling.controller.spec.ts` | Unit test cho controller |

### Task Dependencies
```
T1 (module setup)
  ├── T2 (controller skeleton)
  │     └── T10 (controller complete)
  └── T3 (service skeleton)
        ├── T4 + T5 (DTOs)
        │     ├── T6 (DTO tests)
        │     └── T7 + T8 (service logic)
        │           └── T9 (service tests)
        └── T11 (controller tests)
```

---

## 12. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Circular dependency: rooms ↔ scheduling module | Build fail | Thấp | Dùng `TypeOrmModule.forFeature` thay vì import rooms module |
| Missing database index trên booking time range | Slow query | Trung bình | Kiểm tra index hiện có; thêm migration nếu thiếu |
| Query quá phức tạp (nhiều JOIN + EXISTS) | Chậm response | Thấp | QueryBuilder với selective columns, limit 20 |
| Concurrency: kết quả thay đổi giữa lúc query và booking | UX: user thấy phòng nhưng không đặt được | Cao (đã biết) | Spec đã define là snapshot; conflict check ở luồng sau |

---

## 13. Acceptance Criteria Traceability

| AC- ID | Test Scenario | Verification |
|---|---|---|
| AC-001 | S1 | Happy path — response có rooms, score > 0 |
| AC-002 | S3 | Missing startTime → 422 |
| AC-003 | S4, S5 | Duration invalid/over 24h → 422 với code SCHEDULING_DURATION_TOO_LONG |
| AC-004 | S6 | Past startTime → 422 |
| AC-005 | S7 | attendeeCount <= 0 → 422 |
| AC-006 | S8 | No token → 401 |
| AC-007 | S9 | No permission → 403 |
| AC-008 | S10 | Maintenance/inactive rooms excluded |
| AC-009 | S11 | Overlap booking → room excluded |
| AC-010 | S12 | Capacity < attendeeCount → room excluded |
| AC-011 | S13 | Sort theo diff ASC → room_name ASC → room_code ASC |
| AC-012 | S14 | Equipment EXISTS: 1 healthy camera đủ, faulty không loại |
| AC-013 | S15 | No equipment params → filter bỏ qua |
| AC-014 | S16 | Empty result → 200 với data: [] |
| AC-015 | — | Concurrency: snapshot không lock (spec requirement) |
| AC-016 | S17 | Back-to-back booking OK (no buffer time) |
| AC-017 | S15 | allowRecording=false → không filter |
| AC-018 | S18 | Max 20 rooms, meta.resultLimit = 20 |

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | ✅ PASS | Không thêm bảng mới, không sửa schema |
| **Security Gate** | ✅ PASS | Không có plain text credential, dùng JWT guard |
| **Scope Gate** | ✅ PASS | Không implement out-of-scope feature |
| **Module Gate** | ✅ PASS | Scheduling module riêng, không circular dependency |
| **API Gate** | ✅ PASS | Response format đúng convention, HTTP codes đúng |
| **Auth Gate** | ✅ PASS | JwtAuthGuard + PermissionsGuard với scheduling.suggest.rooms |
| **Test Gate** | ✅ PASS | Unit test cho DTO, service, controller |

## Complexity Tracking

| Complexity Item | Justification | Alternative |
|---|---|---|
| Equipment EXISTS subquery | Cần kiểm tra EXISTS theo room_id + equipment_type + asset_status + health_status | Dùng rooms.has_camera flag (kém chính xác) — chọn EXISTS vì spec yêu cầu check health status |
