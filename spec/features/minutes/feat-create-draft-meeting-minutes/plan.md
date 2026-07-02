# Implementation Plan: Create Draft Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo plan cho feat-create-draft-meeting-minutes | Toàn bộ file |

## 1. Feature Summary
Bổ sung endpoint `POST /api/v1/meetings/:meetingId/minutes` cho phép Host tạo một bản ghi `meeting_minutes` trạng thái DRAFT, kế thừa dữ liệu meeting/participants, khóa cứng các trường đối soát theo BR2, và chỉ Host mới thấy được (BR1, `visibility_level = private`).

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL, theo đúng baseline CLAUDE.md. Không dùng Prisma, không migration schema mới (bảng đã có sẵn).

### 2.2 Existing Codebase Analysis
- `src/modules/minutes/minutes.module.ts`: module đã tồn tại nhưng chỉ có entity registration, chưa có controller/service.
- `src/modules/minutes/entities/meeting-minutes.entity.ts`: entity đầy đủ, khớp baseline SQL.
- `src/modules/meetings/entities/meeting.entity.ts`, `meeting-participant.entity.ts`: dùng để đọc dữ liệu nguồn.
- `src/modules/meetings/services/meetings.service.ts`: tham khảo pattern `checkUserPermission`, host-check, error payload format, transaction qua `this.dataSource`.
- `src/modules/meetings/controllers/meetings.controller.ts`: tham khảo pattern controller (guards, DTO, response shape).
- `src/database/seeds/20260618000001-SeedMeetingNotePermissions.ts`: template cho seed permission mới.

### 2.3 Patterns to Follow
- Controller method trả `{ success, message, data }`.
- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.minutes.create')`.
- Lấy user hiện tại: `@CurrentUser() user: { userId: string }`.
- Exception: `NotFoundException`/`ForbiddenException`/`ConflictException` với payload `{ success: false, message, error: { code, details } }`.
- Transaction: `this.dataSource.transaction(async (manager) => {...})`.

## 3. Scope Confirmation

### 3.1 In Scope
- 1 endpoint tạo biên bản nháp.
- Guard: Host-only, meeting status, chống trùng.
- Seed permission mới.
- Unit test cho service (happy path + các nhánh lỗi chính) và controller (wiring/guard).

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS — không xử lý secret |
| SEC-02 (auth bắt buộc) | PASS — JwtAuthGuard + PermissionsGuard + host ownership check |
| SEC-03 (input validation) | PASS — DTO + ValidationPipe whitelist |
| DATA-01 (soft-delete) | PASS — không hard-delete gì trong feature này |
| ARCH-01 (service boundary) | PASS — chỉ đọc qua entity trong cùng process (modular monolith), không gọi service module khác qua DB trực tiếp kiểu cross-service |
| ARCH-02 (async cho >2s) | PASS — thao tác đồng bộ, nhanh (< 500ms dự kiến), không cần queue |
| ARCH-03 (idempotency) | PASS — gọi lại trả 409 thay vì tạo trùng (natural idempotency) |
| ENG-01 (test coverage) | Áp dụng — xem mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng — thêm `@ApiOperation`/`@ApiResponse` |
| ENG-03 (error không lộ stack trace) | PASS — dùng NestJS exception filter chung |

### 3.4 Complexity Tracking
Không có complexity bất thường. Không cần ADR.

## 4. Data Model Impact
Xem data-model.md. Tóm tắt: 0 bảng mới, 0 cột mới, 1 permission mới (seed).

### 4.1 Bảng bị ảnh hưởng (cập nhật, không thêm mới)
Không có (chỉ đọc `meetings`, `meeting_participants`).

### 4.2 Bảng được INSERT (tạo mới)
`meeting_minutes` (1 dòng), `audit_logs` (1 dòng), `permissions` + `role_permissions` (qua seed, không phải qua request runtime).

### 4.3 Seed / Migration
Không có migration. 1 seed file mới: `SeedMeetingMinutesCreatePermission.ts`.

## 5. API / Contract Plan

### 5.1 Endpoint
`POST /api/v1/meetings/:meetingId/minutes`

### 5.2 Request
```jsonc
{ "title": "string, optional, max 255" }
```

### 5.3 Success Response
`201 Created` — xem spec.md mục 5.3.

### 5.4 Error Responses
`400 VALIDATION_ERROR`, `401 Unauthorized`, `403 NOT_MEETING_HOST` / `403 FORBIDDEN`, `409 MEETING_HOST_NOT_ASSIGNED` / `409 MEETING_NOT_STARTED` / `409 MEETING_CANCELLED` / `409 MINUTES_ALREADY_EXISTS`, `404 MEETING_NOT_FOUND`.

### 5.5 Full Contract
Xem `contracts/create-draft-minutes-api.md`.

## 6. Authorization Plan

### 6.1 Permission Design
`meeting.minutes.create`, module_code=`minutes`.

### 6.2 Authorization Flow
1. `JwtAuthGuard` xác thực token.
2. `PermissionsGuard` + `@RequirePermissions('meeting.minutes.create')` kiểm tra permission cấp role.
3. Service kiểm tra thêm resource ownership: `meeting.hostId === authUser.userId`.

### 6.3 Error
Thiếu permission → 403 `FORBIDDEN` (guard tầng framework). Có permission nhưng không phải Host → 403 `NOT_MEETING_HOST` (service tầng business).

## 7. Business Logic Plan

### 7.1 Transaction Boundary
```text
BEGIN TRANSACTION
  1. SELECT meeting FOR UPDATE (lock nhẹ theo meetingId) — tránh race condition khi tạo trùng
  2. Validate meeting tồn tại, chưa xóa mềm
  3. Validate hostId === authUser.userId (nếu hostId NULL -> lỗi riêng)
  4. Validate meeting.status IN (in_progress, completed); nếu cancelled -> lỗi riêng; còn lại -> MEETING_NOT_STARTED
  5. SELECT meeting_minutes WHERE meeting_id = :id AND deleted_at IS NULL (trong cùng transaction, sau khi đã lock meeting) -> nếu có -> MINUTES_ALREADY_EXISTS
  6. SELECT meeting_participants WHERE meeting_id = :id -> build attendeesSnapshotJson
  7. INSERT meeting_minutes (status=draft, visibility=private, prepared_by=host, ...)
  8. INSERT audit_logs (action_type=meeting_minutes_draft_created)
COMMIT
```

### 7.2 Outside Transaction
Không có (không có notification/side-effect async trong feature này).

### 7.3 State Machine
`(không tồn tại) → draft`. Không có transition khác trong feature này.

### 7.4 Key Business Rules Implemented
BR1 (visibility=private), BR2 (không nhận input cho actual time/attendance, chỉ đọc snapshot).

## 8. Validation Plan

### 8.1 Input Validation (DTO)
`title?: string` — `@IsOptional() @IsString() @MaxLength(255)`.
`meetingId` — `ParseUUIDPipe` ở controller.

### 8.2 Business Validation (Service)
Theo thứ tự ở mục 7.1: meeting tồn tại → host ownership → meeting status → trùng bản ghi.

## 9. Error Handling Plan

### 9.1 Exception Mapping
| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Meeting không tồn tại/đã xóa | `NotFoundException` | `MEETING_NOT_FOUND` |
| Không phải Host | `ForbiddenException` | `NOT_MEETING_HOST` |
| `hostId` null | `ConflictException` | `MEETING_HOST_NOT_ASSIGNED` |
| Status chưa bắt đầu | `ConflictException` | `MEETING_NOT_STARTED` |
| Status cancelled | `ConflictException` | `MEETING_CANCELLED` |
| Đã có minutes | `ConflictException` | `MINUTES_ALREADY_EXISTS` |

### 9.2 Transaction Error Handling
Mọi lỗi nghiệp vụ throw trong transaction sẽ tự động rollback (TypeORM transaction callback).

### 9.3 Notification Error (Non-blocking)
Không áp dụng (không có notification trong feature này).

## 10. Testing Strategy

### 10.1 Unit Tests
`minutes.service.spec.ts`: happy path (in_progress), happy path (completed), not-host, host-null, status chưa bắt đầu, status cancelled, đã tồn tại minutes, snapshot đúng dữ liệu participants.

### 10.2 Integration Test Ideas
(Ghi chú cho tương lai, không bắt buộc phải có DB thật trong phạm vi PR này) — test qua thật DB: tạo meeting + participants + gọi API + assert DB.

### 10.3 Permission Seed Test
Không bắt buộc unit test riêng cho seed script (theo pattern hiện có, các seed khác cũng không có test).

## 11. Implementation Phases

### Phase 1: Preparation
DTOs, response DTO.

### Phase 2: Service Logic
`MinutesService.createDraft`.

### Phase 3: Controller Endpoint
`MinutesController`, wire `minutes.module.ts`.

### Phase 4: Seed & Tests
Seed permission file, unit tests, chạy lint/build/test.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Race condition tạo trùng minutes (không có DB unique constraint) | Lock meeting row (`FOR UPDATE`) trong transaction trước khi kiểm tra tồn tại + insert; rủi ro thấp vì chỉ Host gọi được |
| Seed permission không tự chạy (không có runner) | Ghi rõ hướng dẫn chạy thủ công trong quickstart.md, theo đúng pattern các seed khác đã có |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.8.

## Artifacts Produced
`spec.md`, `research.md`, `plan.md`, `data-model.md`, `contracts/create-draft-minutes-api.md`, `quickstart.md`, `checklists/requirements.md`, `tasks.md`.
