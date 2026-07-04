# Implementation Plan: Update Draft Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo plan cho feat-update-draft-meeting-minutes (UC-MKM-04 / UC-132) | Toàn bộ file |

## 1. Feature Summary
Thêm 1 endpoint `PATCH /api/v1/meeting-minutes/:id` cho phép người tạo biên bản (`preparedBy`) hoặc Host hiện tại của meeting (`meeting.hostId`) cập nhật `title`/`minutesContent`/`decisionsJson`/`actionItemsJson` của một `meeting_minutes` đang `draft`, dùng optimistic locking qua `versionNo` và refresh `attendeesSnapshotJson` khi meeting đã `completed`. Không thêm bảng/cột mới.

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL, theo đúng baseline CLAUDE.md. Không dùng Prisma, không migration bảng mới (chỉ seed 1 permission mới qua migration).

### 2.2 Existing Codebase Analysis
- `src/modules/minutes/services/minutes.service.ts`: đã có `createDraft`, `findMinutesList`, `addAttachment`, `listAttachments`, `removeAttachment`. Feature này thêm method mới `updateDraft(minutesId, dto, authUser)`. **Lưu ý**: file hiện tại có vẻ thiếu dấu đóng `}` cho method `findMinutesList` trước khối comment "Attachments" (dòng ~416-428 khi đọc) — cần Codex kiểm tra lại cấu trúc method thực tế trước khi chèn method mới, tránh chèn nhầm vào giữa 2 method.
- `src/modules/minutes/entities/meeting-minutes.entity.ts`: đã có đủ cột cần dùng — `title`, `minutesContent`, `decisionsJson`, `actionItemsJson`, `attendeesSnapshotJson`, `versionNo`, `preparedBy`, `status`. Không cần sửa entity.
- `src/modules/minutes/controllers/minutes-list.controller.ts` (`MeetingMinutesListController`, `@Controller('meeting-minutes')`): route `PATCH :id` nên đặt cùng controller này để giữ prefix `meeting-minutes` nhất quán với GET list (`GET meeting-minutes`) — quyết định cụ thể (cùng file hay controller mới cùng prefix) để lúc code, không ảnh hưởng spec, theo đúng cách `feat-attach-minutes-document/plan.md` đã xử lý.
- `src/modules/minutes/controllers/minutes.controller.ts` (`MinutesController`, route `POST meetings/:meetingId/minutes`): route tạo draft nằm ở prefix khác (`meetings/:meetingId/minutes`, không phải `meeting-minutes`) — đây là baseline đã tồn tại, feature này KHÔNG đổi route đó, chỉ thêm route mới độc lập.
- `src/modules/minutes/services/minutes.service.ts` (`loadMinutesForOwnerCheck`, dùng cho attachment): kiểm tra `minutes.preparedBy !== authUserId` → `403 NOT_MINUTES_OWNER`. Feature này **không tái sử dụng trực tiếp** hàm đó vì ownership rule ở đây rộng hơn (thêm nhánh `meeting.hostId`) — viết logic ownership riêng trong `updateDraft`, có thể refactor `loadMinutesForOwnerCheck` thành hàm dùng chung sau nếu cần (không bắt buộc trong phạm vi feature này).
- `src/modules/administration/services/audit-logs.service.ts`: có sẵn `logEntityChange({userId, actionType, entityType, entityId, oldValueJson, newValueJson})` — phù hợp hơn `logAction` (dùng ở `createDraft`) vì feature này có before/after rõ ràng.
- `src/database/migrations/20260702010000-SeedMeetingMinutesReadPermission.ts`: pattern migration seed permission chuẩn — copy để tạo migration mới cho `meeting.minutes.update`.

### 2.3 Patterns to Follow
- Controller trả `{ success, message, data }`.
- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.minutes.update')`.
- `ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })` — inline ở controller (pattern `minutes.controller.ts`) hoặc global (đã bật ở `main.ts` theo CLAUDE.md mục 13.2 — xác nhận lại khi code, tránh khai báo trùng).
- Transaction: `this.dataSource.transaction(async (manager) => {...})`, lock `meeting_minutes` bằng `pessimistic_write` (giống `createDraft`/`addAttachment`).
- Exception: `NotFoundException`/`ForbiddenException`/`ConflictException`/`BadRequestException` với payload `{ success: false, message, error: { code, details } }`, đúng format toàn dự án.

## 3. Scope Confirmation

### 3.1 In Scope
- 1 endpoint `PATCH /api/v1/meeting-minutes/:id`.
- Ownership rule mở rộng (`preparedBy` OR `meeting.hostId`).
- Optimistic locking qua `versionNo`.
- Refresh `attendeesSnapshotJson` có điều kiện (`meeting.status = completed`).
- 1 permission mới (seed qua migration).
- Unit test cho service (happy path + toàn bộ nhánh lỗi) và controller (wiring/guard).

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS — không xử lý secret |
| SEC-02 (auth bắt buộc) | PASS — JwtAuthGuard + PermissionsGuard + ownership check mở rộng |
| SEC-03 (input validation) | PASS — DTO validate strict, giới hạn độ dài/số lượng field JSON |
| DATA-01 (soft-delete) | N/A — feature này không xóa bản ghi nào |
| ARCH-01 (service boundary) | PASS — chỉ dùng entity trong module `minutes`/`meetings` qua injection sẵn có, không gọi chéo service module khác |
| ARCH-02 (async cho >2s) | PASS — update text/JSON đồng bộ, không cần `background_jobs` |
| ARCH-03 (idempotency) | PASS — gọi lại PATCH với `versionNo` đã dùng luôn trả 409 thay vì ghi đè âm thầm |
| ENG-01 (test coverage) | Áp dụng — xem mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng — `@ApiOperation`/`@ApiBody`/`@ApiResponse` đầy đủ mã lỗi |
| ENG-03 (error không lộ stack trace) | PASS — dùng NestJS exception filter chung |

### 3.4 Complexity Tracking
Điểm phức tạp duy nhất là ownership rule mở rộng (2 nhánh OR) + optimistic locking + refresh snapshot có điều kiện — cả 3 đều là logic đơn giản, không cần ADR riêng. Không có complexity bất thường khác.

## 4. Data Model Impact
Tóm tắt: 0 bảng mới, 0 cột mới, 1 permission mới (seed qua migration).

### 4.1 Bảng bị ảnh hưởng
`meeting_minutes` (UPDATE `title`, `minutes_content`, `decisions_json`, `action_items_json`, `attendees_snapshot_json` có điều kiện, `version_no`), `meetings` (chỉ đọc `host_id`/`status`, không ghi), `meeting_participants` (chỉ đọc khi refresh snapshot).

### 4.2 Bảng được INSERT
`audit_logs` (1 dòng/lần update thành công), `permissions` + `role_permissions` (qua migration, không phải runtime).

### 4.3 Seed / Migration
1 migration mới: `SeedMeetingMinutesUpdatePermission` (copy pattern từ `20260702010000-SeedMeetingMinutesReadPermission.ts`), seed permission `meeting.minutes.update`, module_code=`minutes`, action_code=`minutes.update`, roles=`INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.

## 5. API / Contract Plan

### 5.1 Endpoint
- `PATCH /api/v1/meeting-minutes/:id`

### 5.2 Request / Response
Xem spec.md mục 5.2/5.3.

### 5.3 Success Response
`200 OK` — xem spec.md mục 5.3.

### 5.4 Error Responses
`400 VALIDATION_ERROR (NO_UPDATE_FIELD và các lỗi field khác)`, `401 Unauthorized`, `403 FORBIDDEN / NOT_MINUTES_OWNER`, `404 MINUTES_NOT_FOUND`, `409 MINUTES_NOT_DRAFT / MINUTES_VERSION_CONFLICT`.

## 6. Authorization Plan

### 6.1 Permission Design
`meeting.minutes.update`, module_code=`minutes`.

### 6.2 Authorization Flow
1. `JwtAuthGuard` xác thực token.
2. `PermissionsGuard` + `@RequirePermissions('meeting.minutes.update')` kiểm tra permission cấp role.
3. Service kiểm tra thêm ownership: `minutes.preparedBy === authUser.userId OR meeting.hostId === authUser.userId`. Business Admin/System Admin **không** được bypass (khác `feat-view-meeting-minutes-detail` — xem spec.md mục 1.5, đây là quyết định có chủ đích của Product Owner).

### 6.3 Error
Thiếu permission → `403 FORBIDDEN` (guard). Có permission nhưng không thỏa ownership → `403 NOT_MINUTES_OWNER` (service).

## 7. Business Logic Plan

### 7.1 Transaction Boundary — Update
```text
1. (Trước transaction) Validate DTO có ít nhất 1 field trong {title, minutesContent, decisionsJson, actionItemsJson}
   -> nếu không có -> 400 VALIDATION_ERROR (NO_UPDATE_FIELD)
2. BEGIN TX
3. SELECT meeting_minutes FOR UPDATE WHERE id = :minutesId (lock, pessimistic_write)
4. Validate: tồn tại + chưa xóa mềm -> 404 MINUTES_NOT_FOUND
5. SELECT meetings WHERE id = minutes.meetingId (đọc hostId + status, không lock)
6. Validate ownership: authUser.userId === minutes.preparedBy OR authUser.userId === meeting.hostId
   -> không thỏa -> 403 NOT_MINUTES_OWNER
7. Validate: minutes.status === 'draft' -> 409 MINUTES_NOT_DRAFT
8. Validate: dto.versionNo === minutes.versionNo
   -> lệch -> 409 MINUTES_VERSION_CONFLICT (kèm currentVersionNo + currentData hiện tại)
9. Áp field được gửi: nếu dto.title !== undefined -> minutes.title = dto.title (tương tự minutesContent/decisionsJson/actionItemsJson)
10. Với actionItemsJson: with mỗi item không có `id` -> gán randomUUID() (FR-011); item có `id` cũ -> giữ nguyên (FR-012)
11. NẾU meeting.status === 'completed':
      participants = SELECT meeting_participants WHERE meeting_id = minutes.meetingId
      minutes.attendeesSnapshotJson = participants.map(p => ({userId, participantRole, attendanceStatus, joinedAt, leftAt}))
12. minutes.versionNo += 1
13. SAVE minutes
14. auditLogsService.logEntityChange({
      userId: authUser.userId, actionType: 'meeting_minutes_updated', entityType: 'meeting_minutes',
      entityId: minutesId,
      oldValueJson: { versionNo: oldVersionNo },
      newValueJson: { versionNo: minutes.versionNo, updatedFields: Object.keys(dto).filter(k => k !== 'versionNo') },
    })
COMMIT
15. Trả về minutes đã cập nhật đầy đủ (theo spec.md mục 5.3)
```
Lưu ý: bước 14 (audit log) nên chạy TRONG transaction (dùng `manager` thay vì repository mặc định của `AuditLogsService`) để nhất quán với `createDraft`/`addAttachment` — cần kiểm tra `AuditLogsService.logEntityChange` có hỗ trợ nhận `EntityManager` tùy biến hay không; nếu không, theo đúng pattern `createDraft` (gọi audit NGOÀI transaction, chấp nhận audit là best-effort/fail-safe theo thiết kế `AuditLogsService`).

### 7.2 Key Business Rules Implemented
Chỉ `preparedBy` hoặc `meeting.hostId` hiện tại thao tác được, chỉ khi `status = draft`, chỉ khi `versionNo` khớp, refresh snapshot có điều kiện theo `meeting.status`.

## 8. Validation Plan

### 8.1 Input Validation (DTO, class-validator)
- `versionNo`: `@IsInt() @Min(1)`, required.
- `title`: `@IsOptional() @IsString() @MaxLength(255)`.
- `minutesContent`: `@IsOptional() @IsString() @MaxLength(20000)`.
- `decisionsJson`: `@IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({each: true}) @Type(() => DecisionItemDto)`.
- `actionItemsJson`: `@IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({each: true}) @Type(() => ActionItemDto)`.
- `DecisionItemDto`: `decision: @IsString() @IsNotEmpty() @MaxLength(500)`, `responsibleUserId?: @IsOptional() @IsUUID()`.
- `ActionItemDto`: `id?: @IsOptional() @IsUUID()`, `title: @IsString() @IsNotEmpty() @MaxLength(255)`, `assigneeUserId?: @IsOptional() @IsUUID()`, `dueDate?: @IsOptional() @IsDateString()`, `priority?: @IsOptional() @IsIn(['low','medium','high'])`.
- Validate "ít nhất 1 field" (FR-008): **không** làm bằng class-validator decorator (khó biểu diễn "at least one of N fields" gọn gàng) — làm thủ công đầu method service, trước khi mở transaction.

### 8.2 Business Validation (Service)
Theo thứ tự ở mục 7.1: tồn tại → ownership → status draft → version match → áp dụng field.

## 9. Error Handling Plan

### 9.1 Exception Mapping
| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Không có field nào để update | `BadRequestException` | `VALIDATION_ERROR` (`NO_UPDATE_FIELD`) |
| Biên bản không tồn tại/đã xóa | `NotFoundException` | `MINUTES_NOT_FOUND` |
| Không phải `preparedBy`/`hostId` | `ForbiddenException` | `NOT_MINUTES_OWNER` |
| Status không phải draft | `ConflictException` | `MINUTES_NOT_DRAFT` |
| `versionNo` lệch | `ConflictException` | `MINUTES_VERSION_CONFLICT` |
| Field vượt giới hạn độ dài/số lượng | `BadRequestException` (ValidationPipe) | `VALIDATION_ERROR` |

### 9.2 Transaction Error Handling
Toàn bộ lỗi nghiệp vụ throw trong transaction DB tự động rollback (TypeORM transaction callback) — không có tác vụ ngoài transaction (khác `feat-attach-minutes-document` vốn có storage I/O ngoài transaction).

### 9.3 Notification Error
Không áp dụng (không có notification trong feature này).

## 10. Testing Strategy

### 10.1 Unit Tests
`minutes.service.spec.ts` (bổ sung case mới cho `updateDraft`): happy path partial update từng field riêng lẻ, happy path full 4 field, not-owner (cả preparedBy khác lẫn không phải host), owner-by-host-only (preparedBy khác nhưng đúng host hiện tại), status không phải draft, version conflict, thiếu versionNo, không có field nào update, vượt giới hạn độ dài/số lượng, action item không có `id` được tự sinh, action item có `id` cũ được giữ nguyên, refresh snapshot khi meeting completed, không refresh khi meeting in_progress, race condition 2 request cùng version (test qua mock lock hoặc integration test riêng nếu cần).

### 10.2 Integration Test Ideas
(Không bắt buộc trong phạm vi PR này) — test qua DB thật: 2 request PATCH đồng thời cùng `versionNo` qua Promise.all, assert chỉ 1 thành công.

## 11. Implementation Phases

### Phase 1: Preparation
DTO request (`UpdateDraftMinutesDto`, `DecisionItemDto`, `ActionItemDto`), response type (`UpdateDraftMinutesResponseDto`, có thể tái dùng cấu trúc gần giống `DraftMinutesResponseDto` nhưng thêm `decisionsJson`/`actionItemsJson`).

### Phase 2: Service Logic
`MinutesService.updateDraft`.

### Phase 3: Controller Endpoint
Thêm route `PATCH :id` vào `MeetingMinutesListController` (hoặc controller mới cùng prefix `meeting-minutes` — quyết định lúc code).

### Phase 4: Seed & Tests
Migration seed permission `meeting.minutes.update`, unit test service + controller, chạy lint/build/test.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Cấu trúc hiện tại của `minutes.service.ts` có khả năng thiếu dấu đóng method (xem mục 2.2) | Codex phải đọc lại toàn bộ file thật kỹ trước khi chèn method mới, chạy `npm run build`/lint ngay sau khi thêm để phát hiện sớm lỗi cú pháp không liên quan tới feature này nhưng có thể bị lộ ra |
| Ownership rule mở rộng (2 nhánh OR) dễ viết sai, dẫn tới rò rỉ quyền sửa | Unit test riêng cho từng nhánh: đúng preparedBy sai host, sai preparedBy đúng host, sai cả 2, đúng cả 2 |
| `AuditLogsService.logEntityChange` có thể không hỗ trợ chạy trong cùng `EntityManager` của transaction (audit ngoài transaction) | Chấp nhận audit best-effort ngoài transaction giống `createDraft`, không chặn response nếu audit lỗi (đã có `failSafe` built-in trong `AuditLogsService`) |
| `versionNo` conflict response cần trả `currentData` đầy đủ — dễ quên field khi code | Đối chiếu với spec.md mục 6.4 làm checklist khi viết DTO lỗi |
| 2 controller minutes hiện có route prefix khác nhau (`meetings/:meetingId/minutes` vs `meeting-minutes`) dễ gây nhầm khi thêm route mới | Route PATCH mới đặt ở prefix `meeting-minutes/:id`, không đụng route `POST meetings/:meetingId/minutes` đã có |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.7.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `quickstart.md`.
