# Implementation Plan: Link Minutes Resources

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo plan cho feat-link-minutes-resources (chưa implement — chỉ lên spec/plan/tasks theo yêu cầu) | Toàn bộ file |

## 1. Feature Summary
Bổ sung 1 endpoint `PATCH /api/v1/meeting-minutes/:id/link-resources` cho phép Host (`preparedBy`/`meeting.hostId`) gắn hoặc gỡ tham chiếu tới 1 file recording (`media_files`) và/hoặc 1 transcript (`transcripts`) cho biên bản đang `draft`, với điều kiện tài nguyên thuộc đúng `meeting_id` và cuộc họp đã `completed`. Dùng lại 2 cột đã có sẵn trong `meeting_minutes` (`linked_recording_file_id`, `linked_transcript_id`) — không migration schema.

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL, không migration bảng/cột mới (chỉ 1 migration seed permission). Không dùng Prisma.

### 2.2 Existing Codebase Analysis
- `src/modules/minutes/entities/meeting-minutes.entity.ts` (dòng 75-79, 114-118): `linkedTranscriptId`/`linkedRecordingFileId` đã có sẵn, kèm relation `@JoinColumn`. Không sửa entity.
- `src/modules/minutes/services/minutes.service.ts`:
  - `updateDraft()` (dòng ~1210): pattern ownership tham khảo chính — `isOwner = minutes.preparedBy === userId || meeting?.hostId === userId`, lock `pessimistic_write`, check `status === draft`.
  - `findMinutesDetail()` (dòng ~1027-1060): đã đọc `linkedTranscriptId`/`linkedRecordingFileId` để populate `relatedResources` — **không cần sửa**, tự động phản ánh giá trị mới sau khi feature này ghi.
  - `MinutesAiDraftProcessor` (dòng ~280, 302): nơi DUY NHẤT hiện ghi `linkedTranscriptId` (side-effect AI draft) — feature này bổ sung đường ghi tường minh thứ 2 qua API, không đụng tới processor này.
- `src/modules/recording/entities/media-file.entity.ts`: `MediaFileType` enum có `AUDIO`/`VIDEO` — dùng để validate `recordingFileId`.
- `src/modules/transcription/entities/transcript.entity.ts`: có `meetingId` trực tiếp — dùng để validate `transcriptId`.
- `src/modules/meetings/entities/meeting.entity.ts`: `MeetingStatus.COMPLETED = 'completed'` — dùng cho FR-006/FR-011.
- `src/modules/minutes/minutes.module.ts`: đã import `RecordingModule`, `TranscriptionModule` (dù chỉ export `TypeOrmModule`) — pattern hiện tại trong `minutes.service.ts` là dùng trực tiếp `this.dataSource.getRepository(TranscriptEntity)`/`this.dataSource.getRepository(MediaFileEntity)` (đã dùng ở `findMinutesDetail`), KHÔNG cần đăng ký thêm `TypeOrmModule.forFeature` — tái sử dụng nguyên pattern này, không sửa module.
- `src/database/migrations/20260717000001-FixMinutesAttachmentEmployeeRole.ts`: **bài học trực tiếp** — seed permission mới của feature này PHẢI dùng role code thật (`EMPLOYEE`), KHÔNG dùng `INTERNAL_USER` như các migration cũ từng seed sai.

### 2.3 Patterns to Follow
- Controller trả `{ success, message, data }`, không có `meta` (không phải list).
- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.minutes.link_resources')`.
- Lấy user hiện tại: `@CurrentUser() user: { userId: string }`.
- Exception: `NotFoundException`/`ForbiddenException`/`ConflictException`/`BadRequestException` với payload `{ success: false, message, error: { code, details } }`.
- Transaction: `this.dataSource.transaction(async (manager) => {...})`, lock `meeting_minutes` bằng `pessimistic_write` — giống `updateDraft`.
- Phân biệt `undefined` (giữ nguyên) vs `null` (gỡ) vs UUID hợp lệ (set mới) cho từng field — DTO dùng `@IsOptional()` (cho phép field vắng mặt) kết hợp kiểm tra thủ công trong service (class-validator mặc định không phân biệt tốt `null` tường minh với `IsOptional`, xử lý bằng cách đọc trực tiếp `'recordingFileId' in dto` hoặc kiểm tra `dto.recordingFileId !== undefined` trong service thay vì dựa hoàn toàn vào decorator).
- Đặt method mới `linkResources` trong `MinutesService` hiện có (không tách service riêng) — nhất quán quyết định đã áp dụng cho `addAttachment`/`updateDraft`.

## 3. Scope Confirmation

### 3.1 In Scope
- 1 endpoint `PATCH /meeting-minutes/:id/link-resources`.
- Validate: ownership (Host-only), status draft, meeting completed, resource tồn tại + đúng loại + đúng `meeting_id`.
- 1 permission mới (seed qua migration, role code đúng ngay từ đầu).
- Unit test cho service (happy path + toàn bộ nhánh lỗi) và controller (wiring/guard).

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS — không xử lý secret |
| SEC-02 (auth bắt buộc) | PASS — JwtAuthGuard + PermissionsGuard + ownership check (Host) |
| SEC-03 (input validation) | PASS — `ParseUUIDPipe`/DTO validate `recordingFileId`/`transcriptId` |
| DATA-01 (soft-delete) | N/A — không xóa dữ liệu, chỉ set/unset FK reference |
| ARCH-01 (service boundary) | PASS — chỉ đọc `MediaFileEntity`/`TranscriptEntity` qua `dataSource.getRepository` (đã là pattern hiện có trong `findMinutesDetail`), không gọi service của module `recording`/`transcription` |
| ARCH-02 (async cho >2s) | PASS — vài SELECT + 1 UPDATE, đồng bộ chấp nhận được |
| ARCH-03 (idempotency) | PASS — set lại giá trị giống hệt vẫn trả 200 (xem spec.md mục 1.5, NEEDS CLARIFICATION) |
| ENG-01 (test coverage) | Áp dụng — xem mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng — `@ApiBody`/`@ApiResponse` cho endpoint mới |
| ENG-03 (error không lộ stack trace) | PASS — dùng NestJS exception filter chung |

### 3.4 Complexity Tracking
Không có complexity bất thường. Điểm cần lưu ý: đây là feature GHI thứ 3 trong module `minutes` (sau `update-draft`, `issue`) với 2 tiền lệ ownership KHÔNG nhất quán (`update-draft` chặn admin, `issue` cho admin bypass) — feature này đi theo `update-draft` (quyết định tường minh của Product Owner ngày 2026-07-17, xem spec.md mục 1.5), không phải quyết định kỹ thuật đơn phương.

## 4. Data Model Impact
0 bảng mới, 0 cột mới, 1 permission mới (seed qua migration).

### 4.1 Bảng bị ảnh hưởng (UPDATE, không thêm cột)
`meeting_minutes` (2 cột `linked_recording_file_id`/`linked_transcript_id`, đã có sẵn).

### 4.2 Bảng được INSERT
`audit_logs` (1 dòng/lần liên kết thành công), `permissions` + `role_permissions` (qua migration, không phải runtime).

### 4.3 Seed / Migration
1 migration mới: `SeedMeetingMinutesLinkResourcesPermission` — seed permission `meeting.minutes.link_resources`, module_code=`minutes`, action_code=`minutes.link_resources`, roles=`EMPLOYEE, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN` (role code THẬT, không lặp lại bug `INTERNAL_USER`).

## 5. API / Contract Plan

### 5.1 Endpoints
`PATCH /api/v1/meeting-minutes/:id/link-resources`

### 5.2 Request
Xem spec.md mục 5.2.

### 5.3 Success Response
`200 OK` — xem spec.md mục 5.3.

### 5.4 Error Responses
`400 NO_LINK_FIELD / INVALID_RECORDING_FILE_TYPE`, `401 Unauthorized`, `403 NOT_MINUTES_OWNER / FORBIDDEN`, `404 MINUTES_NOT_FOUND / RECORDING_FILE_NOT_FOUND / TRANSCRIPT_NOT_FOUND`, `409 MINUTES_NOT_DRAFT / MEETING_NOT_COMPLETED / RESOURCE_NOT_SAME_MEETING`.

## 6. Authorization Plan

### 6.1 Permission Design
`meeting.minutes.link_resources`, module_code=`minutes`.

### 6.2 Authorization Flow
1. `JwtAuthGuard` xác thực token.
2. `PermissionsGuard` + `@RequirePermissions('meeting.minutes.link_resources')`.
3. Service kiểm tra ownership: `minutes.preparedBy === authUser.userId OR meeting.hostId === authUser.userId` — **không có nhánh admin bypass** (khác `issue`, giống `updateDraft`, theo quyết định Q&A).

### 6.3 Error
Thiếu permission → 403 `FORBIDDEN` (guard). Có permission nhưng không phải Host → 403 `NOT_MINUTES_OWNER` (service).

## 7. Business Logic Plan

### 7.1 Transaction Boundary — Link/Unlink
```text
1. SELECT meeting_minutes FOR UPDATE WHERE id = :id (lock)
2. Validate: tồn tại + chưa xóa mềm -> 404 MINUTES_NOT_FOUND
3. Load meeting (meetingId của minutes) -> Validate ownership: preparedBy === userId OR meeting.hostId === userId -> 403 NOT_MINUTES_OWNER
4. Validate: minutes.status === draft -> 409 MINUTES_NOT_DRAFT
5. Validate: meeting.status === completed -> 409 MEETING_NOT_COMPLETED
6. Validate: có ít nhất 1 trong 2 field (recordingFileId/transcriptId) xuất hiện trong body -> 400 NO_LINK_FIELD
7. NẾU dto.recordingFileId !== undefined VÀ !== null:
   SELECT media_files WHERE id = :recordingFileId AND deletedAt IS NULL
   -> không có -> 404 RECORDING_FILE_NOT_FOUND
   -> fileType NOT IN (audio, video) -> 400 INVALID_RECORDING_FILE_TYPE
   -> meetingId !== minutes.meetingId -> 409 RESOURCE_NOT_SAME_MEETING
8. NẾU dto.transcriptId !== undefined VÀ !== null:
   SELECT transcripts WHERE id = :transcriptId
   -> không có -> 404 TRANSCRIPT_NOT_FOUND
   -> meetingId !== minutes.meetingId -> 409 RESOURCE_NOT_SAME_MEETING
9. UPDATE meeting_minutes SET
     linked_recording_file_id = CASE WHEN dto.recordingFileId !== undefined THEN dto.recordingFileId ELSE (giữ nguyên) END,
     linked_transcript_id = CASE WHEN dto.transcriptId !== undefined THEN dto.transcriptId ELSE (giữ nguyên) END
   WHERE id = :id
10. INSERT audit_logs (action_type=meeting_minutes_resources_linked, metadataJson={old, new})
COMMIT
```

### 7.2 Key Business Rules Implemented
Chỉ Host thao tác được, chỉ khi `status=draft` VÀ `meeting.status=completed`, tài nguyên phải cùng `meeting_id`, `recordingFileId` phải đúng loại audio/video.

## 8. Validation Plan

### 8.1 Input Validation
- `id` (path) — `ParseUUIDPipe`.
- `recordingFileId`/`transcriptId` (body) — `@IsOptional() @IsUUID('4') @ValidateIf(...)` để chấp nhận cả `null` tường minh (dùng `@IsOptional()` + xử lý `null` thủ công trong service, vì `class-validator` mặc định coi `null` là "có giá trị" khác `undefined`).

### 8.2 Business Validation (Service)
Theo thứ tự ở mục 7.1: tồn tại → ownership → status draft → meeting completed → có field truyền → resource tồn tại/đúng loại/đúng meeting.

## 9. Error Handling Plan

### 9.1 Exception Mapping
| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Biên bản không tồn tại/đã xóa | `NotFoundException` | `MINUTES_NOT_FOUND` |
| Không phải Host | `ForbiddenException` | `NOT_MINUTES_OWNER` |
| Status không phải draft | `ConflictException` | `MINUTES_NOT_DRAFT` |
| Meeting chưa completed | `ConflictException` | `MEETING_NOT_COMPLETED` |
| Không truyền field nào | `BadRequestException` | `NO_LINK_FIELD` |
| Recording file không tồn tại | `NotFoundException` | `RECORDING_FILE_NOT_FOUND` |
| Recording file sai fileType | `BadRequestException` | `INVALID_RECORDING_FILE_TYPE` |
| Transcript không tồn tại | `NotFoundException` | `TRANSCRIPT_NOT_FOUND` |
| Tài nguyên khác meeting | `ConflictException` | `RESOURCE_NOT_SAME_MEETING` |

### 9.2 Transaction Error Handling
Lỗi nghiệp vụ throw trong transaction tự động rollback (TypeORM transaction callback) — không có side effect ngoài DB (không upload file/gọi service ngoài) nên không cần cleanup bù trừ.

### 9.3 Notification Error (Non-blocking)
Không áp dụng (không có notification trong feature này).

## 10. Testing Strategy

### 10.1 Unit Tests
`minutes.service.spec.ts` (bổ sung case mới cho `linkResources`): link recording thành công, link transcript thành công (giữ nguyên field kia), unlink (null) thành công, not-owner (kể cả Business Admin), status không phải draft, meeting chưa completed, recording không tồn tại, recording sai fileType, transcript không tồn tại, tài nguyên khác meeting_id, không truyền field nào, audit log ghi đúng metadata.

### 10.2 Integration Test Ideas
(Không bắt buộc trong phạm vi PR này) — test qua DB thật: tạo minutes draft cho 1 meeting completed có sẵn recording+transcript, gọi PATCH thật, assert `linked_recording_file_id`/`linked_transcript_id` trong DB.

### 10.3 Permission Seed Test
Không bắt buộc unit test riêng cho migration (theo pattern hiện có).

## 11. Implementation Phases

### Phase 1: Preparation
DTO (`LinkMinutesResourcesDto`), response DTO (`LinkMinutesResourcesResponseDto`).

### Phase 2: Service Logic
`MinutesService.linkResources()`.

### Phase 3: Controller Endpoint
Thêm route `PATCH :id/link-resources` vào `MeetingMinutesListController` (cùng controller với `issue`/attachment, đã dùng chung `@Controller('meeting-minutes')`).

### Phase 4: Seed & Tests
Migration seed permission mới (role code đúng ngay từ đầu), unit test service + controller, chạy lint/build/test.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Nhầm lẫn `undefined` (giữ nguyên) vs `null` (gỡ) khi class-validator xử lý DTO | Viết rõ trong plan + code review kỹ phần parse body, thêm unit test riêng cho từng trường hợp (T-case "chỉ truyền 1 field", "truyền null", "không truyền gì") |
| Race condition giữa liên kết và publish (`issue`) cùng lúc | Lock `pessimistic_write` trên `meeting_minutes`, nhất quán `updateDraft`/`addAttachment` |
| Không nhất quán ownership rule giữa các action ghi trong cùng module (`update-draft` vs `issue`) gây nhầm lẫn cho dev sau | Ghi rõ trong spec.md mục 1.5 + plan.md mục 3.4, không tự ý "sửa cho giống nhau" — đây là quyết định nghiệp vụ đã chốt qua Q&A, không phải bug |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.8.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`. Theo yêu cầu người dùng — KHÔNG tạo `research.md`, `data-model.md`, `contracts/*.md`, `quickstart.md`, `checklists/requirements.md` ở giai đoạn này. Viết TRƯỚC khi code (đúng quy trình Speckit chuẩn: spec → plan → tasks → implement), khác với `feat-view-minutes-attachment-detail` (viết sau khi code). **Đã implement xong** sau khi người dùng xác nhận tiếp tục — xem changelog `tasks.md` cho kết quả build/test.
