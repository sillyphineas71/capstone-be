# Implementation Plan: View Meeting Minutes Detail

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo plan cho feat-view-meeting-minutes-detail | Toàn bộ file |

## 1. Feature Summary
Bổ sung endpoint `GET /api/v1/meeting-minutes/:id` trả về toàn bộ dữ liệu chi tiết của một biên bản họp (thông tin chung, nội dung chính, tài nguyên liên quan, file đính kèm) cho người dùng có quyền xem, kèm cờ `permissions.canEdit/canIssue` cho FE. Read-only, không transaction ghi.

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL. Không migration mới, không entity mới, không permission mới (tái dùng `meeting.minutes.read`).

### 2.2 Existing Codebase Analysis
- `src/modules/minutes/services/minutes.service.ts`: đã có `createDraft` + `findMinutesList` (chứa sẵn logic scope rule dạng `Brackets` — mục 264-300). Feature này thêm method `findMinutesDetail`, **tách phần scope-check thành helper riêng** (`resolveAccessScope` hoặc tương tự) để dùng chung ý tưởng với `findMinutesList` mà không copy-paste `Brackets` SQL (detail chỉ cần check 1 bản ghi, không cần query builder phức tạp).
- `src/modules/minutes/controllers/minutes-list.controller.ts`: thêm route `GET :id` vào cùng controller (`@Controller('meeting-minutes')`) — nhất quán resource path với UC-MKM-02.
- `src/modules/minutes/entities/meeting-minutes.entity.ts`: đọc nguyên trạng, không sửa.
- `src/modules/meetings/entities/meeting.entity.ts`, `meeting-participant.entity.ts`: đọc để dựng `generalInfo` (KHÔNG dùng `meeting_participants` cho danh sách attendees — đã đóng băng trong `attendeesSnapshotJson`, chỉ dùng `meeting_participants` nếu cần — thực ra không cần, xem 2.3).
- `src/modules/rooms/entities/room.entity.ts`: đọc `roomName/siteName/areaName/locationDescription`.
- `src/modules/accounts/entities/user.entity.ts`: batch-load `fullName/email` cho các `userId` xuất hiện trong snapshot + `preparedBy/issuedBy/approvedBy` + host.
- `src/modules/transcription/entities/transcript.entity.ts`: đọc tối thiểu (`id, status, versionNo, languageCode`) nếu `linkedTranscriptId` có giá trị.
- `src/modules/recording/entities/media-file.entity.ts`: đọc cho `linkedRecordingFileId` (nếu có) VÀ cho danh sách attachment (`relatedEntityType/relatedEntityId`) — **tái dùng đúng điều kiện lọc đã định nghĩa ở `feat-attach-minutes-document` mục 7.3** (không phụ thuộc feature đó phải deploy trước — chỉ là 1 câu SELECT).
- `src/modules/auth/repositories/authz-read.repository.ts`: dùng `getEffectiveRolesAndPermissions` giống `findMinutesList` để xác định `isAdmin`.

### 2.3 Patterns to Follow
- Controller trả `{ success, message, data }`.
- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.minutes.read')` — **tái dùng permission đã seed, không tạo permission mới** (xem quyết định 6.1).
- Không cần transaction (`dataSource.transaction`) vì toàn bộ là SELECT — dùng `dataSource.getRepository(...)`/`createQueryBuilder` trực tiếp như `findMinutesList`.
- Batch-load tránh N+1: theo đúng pattern đã dùng ở `findMinutesList` (batch load `RoomEntity` riêng thay vì join phức tạp) — áp dụng tương tự cho `UserEntity` (nhiều `userId` trong snapshot) bằng 1 câu `IN (...)`.
- Exception: `NotFoundException`/`ForbiddenException` với payload `{ success: false, message, error: { code, details } }`, giống `createDraft`.

## 3. Scope Confirmation

### 3.1 In Scope
- 1 endpoint `GET /api/v1/meeting-minutes/:id`.
- Scope rule tái sử dụng ý tưởng từ `feat-list-meeting-minutes` (draft→owner-only, published/archived→host-or-participant, admin→all, deleted→404 cho tất cả).
- Ghép dữ liệu từ 6 nguồn: `meeting_minutes`, `meetings`, `rooms`, `users`, `transcripts`, `media_files` (recording + attachments).
- Cờ `permissions.canEdit/canIssue`.
- Unit test cho service (happy path + toàn bộ nhánh authorization/not-found) và controller (wiring/guard).

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS — không xử lý secret |
| SEC-02 (auth bắt buộc) | PASS — JwtAuthGuard + PermissionsGuard + scope rule tầng service |
| SEC-03 (input validation) | PASS — `ParseUUIDPipe` cho `id` |
| DATA-01 (soft-delete) | PASS — không ghi gì, chỉ đọc; tôn trọng `deletedAt IS NULL` |
| ARCH-01 (service boundary) | PASS — chỉ đọc entity của các module khác qua injection trong cùng process (modular monolith), không gọi API nội bộ chéo module |
| ARCH-02 (async cho >2s) | PASS — read-only, nhanh, không cần queue |
| ARCH-03 (idempotency) | PASS — GET thuần túy, tự nhiên idempotent |
| ENG-01 (test coverage) | Áp dụng — xem mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng — `@ApiOperation`/`@ApiResponse` đầy đủ |
| ENG-03 (error không lộ stack trace) | PASS — dùng NestJS exception filter chung |

### 3.4 Complexity Tracking
Điểm phức tạp duy nhất: ghép dữ liệu từ 6 nguồn trong 1 response. Giải quyết bằng cách tách rõ từng bước load tuần tự trong service (không dùng 1 query builder khổng lồ join hết) — dễ đọc, dễ test từng phần, đổi lấy 1 vài round-trip DB thêm (chấp nhận được vì đã trong ngân sách <500ms ở NFR 4.1). Không cần ADR.

## 4. Data Model Impact
0 bảng mới, 0 cột mới, 0 permission mới.

### 4.1 Bảng bị ảnh hưởng
Không có (chỉ đọc: `meeting_minutes`, `meetings`, `rooms`, `users`, `transcripts`, `media_files`).

### 4.2 Bảng được INSERT
Không có.

### 4.3 Seed / Migration
Không có.

## 5. API / Contract Plan

### 5.1 Endpoint
`GET /api/v1/meeting-minutes/:id`

### 5.2 Request
Không có body, chỉ path param `id` (UUID).

### 5.3 Success Response
`200 OK` — xem spec.md mục 5.3.

### 5.4 Error Responses
`400` (UUID không hợp lệ), `401 Unauthorized`, `403 FORBIDDEN / MEETING_MINUTES_ACCESS_DENIED`, `404 MEETING_MINUTES_NOT_FOUND`.

## 6. Authorization Plan

### 6.1 Permission Design
**Quyết định**: KHÔNG tạo permission mới, tái dùng `meeting.minutes.read` đã seed cho UC-MKM-02 — vì về bản chất "xem danh sách" và "xem chi tiết" là cùng một khả năng "đọc biên bản", chỉ khác độ chi tiết. Tránh phình permission table không cần thiết (nhất quán nguyên tắc "không tự ý mở rộng scope" của CLAUDE.md).

### 6.2 Authorization Flow
1. `JwtAuthGuard` xác thực token.
2. `PermissionsGuard` + `@RequirePermissions('meeting.minutes.read')` kiểm tra permission cấp role.
3. Service load `meeting_minutes` + `meeting` liên quan, tính `isAdmin` (`getEffectiveRolesAndPermissions`), áp dụng scope rule FR-006..FR-009 → allow/deny.

### 6.3 Error
Thiếu permission → 403 `FORBIDDEN` (guard). Có permission nhưng không thỏa scope → 403 `MEETING_MINUTES_ACCESS_DENIED` (service). Không tồn tại/đã xóa → 404 `MEETING_MINUTES_NOT_FOUND` (service, luôn ưu tiên trả 404 trước khi tính toán quyền nếu bản ghi không tồn tại — tránh lộ thông tin "tồn tại nhưng không có quyền" theo đúng cách đã làm ở FR-009).

## 7. Business Logic Plan

### 7.1 Đọc dữ liệu — `findMinutesDetail(id, authUser)`
```text
1. SELECT meeting_minutes WHERE id = :id AND deletedAt IS NULL (join meeting)
   -> không có -> 404 MEETING_MINUTES_NOT_FOUND
2. { roles } = authzRepo.getEffectiveRolesAndPermissions(authUser.userId); isAdmin = SYSTEM_ADMIN|BUSINESS_ADMIN
3. IF NOT isAdmin:
     IF minutes.status == draft:
       IF minutes.preparedBy !== authUser.userId -> 403 MEETING_MINUTES_ACCESS_DENIED
     ELSE IF minutes.status IN (published, archived):
       isHost = meeting.hostId === authUser.userId
       isParticipant = EXISTS meeting_participants WHERE meetingId=meeting.id AND userId=authUser.userId
       IF NOT (isHost OR isParticipant) -> 403 MEETING_MINUTES_ACCESS_DENIED
4. userIds = dedupe([...snapshot.map(a => a.userId), meeting.hostId, noteTakerId(nếu có trong snapshot), preparedBy, issuedBy, approvedBy])
5. SELECT users WHERE id IN (:...userIds) -> map userById
6. IF meeting.roomId -> SELECT room WHERE id = meeting.roomId
7. IF minutes.linkedTranscriptId -> SELECT transcript minimal fields
8. IF minutes.linkedRecordingFileId -> SELECT media_file minimal fields
9. SELECT media_files WHERE relatedEntityType='meeting_minutes' AND relatedEntityId=:id AND deletedAt IS NULL ORDER BY uploadedAt DESC -> attachments
10. canEditOrIssue = (minutes.status === draft) AND (isAdmin OR minutes.preparedBy === authUser.userId)
11. Build response DTO gộp toàn bộ (mục 5.3 spec.md)
```
Không có bước ghi (INSERT/UPDATE) nào — toàn bộ SELECT, không cần transaction.

### 7.2 Outside Transaction
Toàn bộ nằm ngoài transaction (không áp dụng khái niệm transaction cho luồng read-only này).

### 7.3 State Machine
Không có transition trong feature này (chỉ đọc `status` hiện tại).

### 7.4 Key Business Rules Implemented
BR-ACCESS (scope rule FR-006..FR-009), quy tắc "deleted luôn 404 cho mọi actor" (FR-009).

## 8. Validation Plan

### 8.1 Input Validation
`id` — `ParseUUIDPipe` ở controller.

### 8.2 Business Validation (Service)
Theo thứ tự ở mục 7.1: tồn tại → scope rule.

## 9. Error Handling Plan

### 9.1 Exception Mapping
| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Biên bản không tồn tại/đã xóa | `NotFoundException` | `MEETING_MINUTES_NOT_FOUND` |
| Không thỏa scope rule | `ForbiddenException` | `MEETING_MINUTES_ACCESS_DENIED` |
| Thiếu permission | `ForbiddenException` (guard) | `FORBIDDEN` |

### 9.2 Transaction Error Handling
Không áp dụng (không có transaction ghi).

### 9.3 Notification Error (Non-blocking)
Không áp dụng.

## 10. Testing Strategy

### 10.1 Unit Tests
`minutes.service.spec.ts` (bổ sung case mới cho `findMinutesDetail`): happy path draft-owner, happy path published-host, happy path published-participant, happy path admin-xem-draft-của-người-khác, not-found, deleted→404 (kể cả admin), draft-không-phải-owner→403, published-không-liên-quan→403, có/không có transcript liên kết, có/không có recording liên kết, có/không có attachments, `permissions.canEdit/canIssue` đúng cho từng trường hợp.

### 10.2 Integration Test Ideas
(Không bắt buộc trong phạm vi PR này) — test qua DB thật: tạo minutes + participants + attachment thật, gọi API, assert response đầy đủ 4 nhóm dữ liệu.

### 10.3 Permission Seed Test
Không áp dụng (không có permission mới).

## 11. Implementation Phases

### Phase 1: Preparation
Response DTO (`MinutesDetailResponseDto` — lồng nhau theo spec.md mục 5.3).

### Phase 2: Service Logic
`MinutesService.findMinutesDetail` + helper `resolveMinutesAccessScope` (tái dùng được cho việc refactor `findMinutesList` sau này, không bắt buộc trong PR này).

### Phase 3: Controller Endpoint
Thêm `GET :id` vào `MeetingMinutesListController`.

### Phase 4: Tests
Unit test service + controller, chạy lint/build/test.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Response quá nhiều round-trip DB (6 nguồn dữ liệu) làm chậm | Chấp nhận ở v1 (dữ liệu nhỏ, có index theo PK/FK); tối ưu bằng batch-load `users` 1 lần thay vì N lần; cân nhắc gộp query nếu đo được vượt NFR 4.1 |
| Logic scope rule bị lặp code giữa `findMinutesList` và `findMinutesDetail` | Chấp nhận trùng lặp nhỏ ở v1 (2 method, không tạo abstraction sớm theo nguyên tắc "không premature abstraction"); nếu xuất hiện thêm feature thứ 3 cần cùng rule, refactor thành shared helper lúc đó |
| `attendeesSnapshotJson`/`decisionsJson`/`actionItemsJson` là `jsonb` không có schema cứng ở tầng DB — dữ liệu cũ (nếu có) có thể thiếu field | Service defensive-parse (dùng optional chaining/default value khi map), không throw lỗi nếu field phụ thiếu |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.8.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`. (Theo yêu cầu người dùng — KHÔNG tạo `research.md`, `data-model.md`, `contracts/*.md`, `quickstart.md`, `checklists/requirements.md` ở giai đoạn này; implementation thực tế sẽ do người dùng tự làm sau.)
