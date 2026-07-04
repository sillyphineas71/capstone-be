# Task List: View Meeting Minutes Detail

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khắc phục các lỗi liên quan đến minutes, cập nhật checklist và hoàn thành unit tests. | Toàn bộ file |
| 2026-07-02 | Khởi tạo tasks cho feat-view-meeting-minutes-detail (chưa implement — chỉ lên spec/plan/tasks theo yêu cầu) | Toàn bộ file |

## Checklist
- [x] T001 [US1] Response DTO (lồng nhau) → `src/modules/minutes/dto/minutes-detail-response.dto.ts`
- [x] T002 [US1] Helper scope rule → `src/modules/minutes/services/minutes.service.ts`
- [x] T003 [US1] Service logic `findMinutesDetail` → `src/modules/minutes/services/minutes.service.ts`
- [x] T004 [US1] Controller endpoint `GET :id` → `src/modules/minutes/controllers/minutes-list.controller.ts`
- [x] T005 [US1] Unit test service → `src/modules/minutes/services/minutes.service.spec.ts`
- [x] T006 [US1] Unit test controller → `src/modules/minutes/controllers/minutes-list.controller.spec.ts`
- [x] T007 Lint/build/test toàn repo

> **Lưu ý**: Toàn bộ task dưới đây là bản kế hoạch (planning) — CHƯA implement. Người dùng sẽ tự thực hiện code sau, theo đúng yêu cầu khi tạo tài liệu này.

## Phase 1: Preparation

### Task T001 [US1] — Tạo response DTO
**File**: `src/modules/minutes/dto/minutes-detail-response.dto.ts`
**Action**: Định nghĩa các interface/class lồng nhau theo spec.md mục 5.3: `MinutesDetailResponseDto` (root), `MinutesGeneralInfoDto`, `MinutesAttendeeDto`, `MinutesMainContentDto`, `MinutesRelatedResourcesDto`, `MinutesAttachmentSummaryDto`, `MinutesPermissionsDto`. Tái dùng `RoomSummaryDto`/`UserSummaryDto` đã có ở `src/modules/meetings/dto/` nếu field khớp (kiểm tra lúc code — không tạo trùng type nếu đã đủ).
**Outcome**: Type dùng làm kiểu trả về của `MinutesService.findMinutesDetail` và response controller.
**Verification**: Type-check pass.

## Phase 2: Service Logic

### Task T002 [US1] — Helper scope rule
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Viết method private `private canAccessMinutes(minutes: MeetingMinutesEntity, meeting: MeetingEntity, userId: string, isAdmin: boolean, isParticipant: boolean): boolean` implement đúng FR-006..FR-008 (không gồm FR-009 — not-found xử lý trước khi gọi tới helper này). Method thuần túy (pure function trên tham số truyền vào), dễ unit test độc lập không cần mock DB.
**Outcome**: Hàm tái sử dụng được, test riêng nhanh với nhiều tổ hợp input.
**Verification**: Unit test T005 cho các tổ hợp true/false của `isAdmin/isParticipant/isHost/status`.

### Task T003 [US1] — Service logic `findMinutesDetail`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Implement theo pseudo-code plan.md mục 7.1:
```text
async findMinutesDetail(id, authUser):
  minutes = dataSource.getRepository(MeetingMinutesEntity)
    .createQueryBuilder('minutes')
    .leftJoinAndSelect('minutes.meeting', 'meeting')
    .where('minutes.id = :id', { id })
    .andWhere('minutes.deletedAt IS NULL')
    .getOne()
  if (!minutes) throw NotFoundException(MEETING_MINUTES_NOT_FOUND)

  { roles } = authzRepo.getEffectiveRolesAndPermissions(authUser.userId)
  isAdmin = roles includes SYSTEM_ADMIN or BUSINESS_ADMIN

  if (!isAdmin) {
    if (minutes.status === DRAFT) {
      if (minutes.preparedBy !== authUser.userId) throw ForbiddenException(MEETING_MINUTES_ACCESS_DENIED)
    } else if ([PUBLISHED, ARCHIVED].includes(minutes.status)) {
      isHost = minutes.meeting.hostId === authUser.userId
      isParticipant = exists meeting_participants where meetingId=minutes.meetingId and userId=authUser.userId
      if (!isHost && !isParticipant) throw ForbiddenException(MEETING_MINUTES_ACCESS_DENIED)
    } else {
      throw ForbiddenException(MEETING_MINUTES_ACCESS_DENIED) // trạng thái lạ, deny-by-default
    }
  }

  attendeeUserIds = (minutes.attendeesSnapshotJson ?? []).map(a => a.userId)
  extraUserIds = [minutes.meeting.hostId, minutes.preparedBy, minutes.issuedBy, minutes.approvedBy].filter(Boolean)
  userIds = dedupe([...attendeeUserIds, ...extraUserIds])
  usersById = SELECT users WHERE id IN (:...userIds) -> Map

  room = minutes.meeting.roomId ? SELECT room WHERE id = minutes.meeting.roomId : null
  transcript = minutes.linkedTranscriptId ? SELECT transcript minimal fields : null
  recording = minutes.linkedRecordingFileId ? SELECT media_file minimal fields : null
  attachments = SELECT media_files WHERE relatedEntityType='meeting_minutes' AND relatedEntityId=id AND deletedAt IS NULL ORDER BY uploadedAt DESC

  canEditOrIssue = minutes.status === DRAFT && (isAdmin || minutes.preparedBy === authUser.userId)

  return buildDetailResponse(minutes, room, usersById, transcript, recording, attachments, canEditOrIssue)
```
**Outcome**: Method hoàn chỉnh, throw đúng exception/code cho từng nhánh lỗi ở spec.md mục 6.
**Verification**: Unit test T005 pass toàn bộ nhánh (happy path × 4 vai trò, not-found, deleted, 2 nhánh 403).

## Phase 3: Controller Endpoint

### Task T004 [US1] — Thêm route `GET :id`
**File**: `src/modules/minutes/controllers/minutes-list.controller.ts`
**Action**: Thêm method vào `MeetingMinutesListController` (đã có sẵn `@Controller('meeting-minutes')`):
```ts
@Get(':id')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('meeting.minutes.read')
async findOne(
  @Param('id', ParseUUIDPipe) id: string,
  @CurrentUser() user: { userId: string },
) {
  const data = await this.minutesService.findMinutesDetail(id, { userId: user.userId });
  return { success: true, message: 'Chi tiet bien ban hop', data };
}
```
Thêm đầy đủ `@ApiOperation`/`@ApiParam`/`@ApiResponse` (200/400/401/403/404) theo pattern các endpoint khác trong cùng file.
**Outcome**: Endpoint hoạt động end-to-end.
**Verification**: Test T006.

## Phase 4: Tests

### Task T005 [US1] — Unit test service
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Mock `DataSource`/`Repository`/`AuthzReadRepository`, test các case liệt kê ở plan.md mục 10.1.
**Outcome**: Coverage đầy đủ nhánh lỗi + happy path (ENG-01: ≥80% cho business logic mới).
**Verification**: `npm run test` pass.

### Task T006 [US1] — Unit test controller
**File**: `src/modules/minutes/controllers/minutes-list.controller.spec.ts`
**Action**: Test controller gọi đúng `findMinutesDetail` với đúng tham số (`id`, `userId`), trả đúng response shape.
**Outcome**: Test pass.
**Verification**: `npm run test` pass.

### Task T007 — Lint/build/test toàn repo
**Action**: Chạy `npm run lint`, `npm run build`, `npm run test` cho toàn repo, đối chiếu với các fail pre-existing đã ghi nhận ở `feat-create-draft-meeting-minutes/tasks.md` T009 (không liên quan module `minutes`).
**Outcome**: Build pass, test mới của `minutes` pass 100%, không phát sinh regression mới.

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001, FR-021 | T003 |
| FR-002 | Không có task riêng — đặc tính tự nhiên của SELECT-only |
| FR-003 | T003 |
| FR-004, FR-013, FR-014, FR-015 | T003, T004, T005 |
| FR-005 | T003 |
| FR-006, FR-007, FR-008 | T002, T003, T005 |
| FR-009 | T003, T005 |
| FR-010, FR-011, FR-012 | T003, T005 |
| FR-016 | T003 (không dùng transaction) |
| FR-017 | T002, T003, T005 |
| FR-018 | Không có task riêng — không sửa entity |
| FR-019, FR-020 | Không có task riêng — mặc định không gọi audit/notification service |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001, AC-002 | T003, T005 |
| AC-003, AC-004 | T003, T005 |
| AC-005, AC-006, AC-007 | T002, T003, T005 |
| AC-008 | T004 (guard) |
| AC-009 | T004 |
| AC-010, AC-011 | T003, T005 |
| AC-012 | T003 (không gọi audit service) |

### Error Code Coverage
| Error Code | HTTP Status | Task(s) |
| :--- | :--- | :--- |
| FORBIDDEN | 403 | T004 (guard) |
| MEETING_MINUTES_ACCESS_DENIED | 403 | T002, T003, T005 |
| MEETING_MINUTES_NOT_FOUND | 404 | T003, T005 |

## Dependencies Graph
```text
T001 ─┐
      ├─> T002 ─> T003 ─> T004
      │                     │
      └─────────────────────┼──> T005, T006 ──> T007
```

## Implementation Order
| Step | Task(s) | Phase | Description |
| :--- | :--- | :--- | :--- |
| 1 | T001 | 1 | Response DTO |
| 2 | T002, T003 | 2 | Scope rule + service logic |
| 3 | T004 | 3 | Controller endpoint |
| 4 | T005, T006 | 4 | Tests |
| 5 | T007 | 4 | Lint/build/test toàn repo |
