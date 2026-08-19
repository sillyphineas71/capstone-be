# Implementation Plan: Live-Share Draft Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-19 | Khởi tạo plan cho feat-live-share-draft-minutes (MKM-LIVE-01), dựa trên khảo sát code thật (`canAccessMinutes`, `EventsGateway`, `ParticipantRole`) và quyết định đã chốt tại spec.md | Toàn bộ file |

## 1. Feature Summary
Thêm cột `is_live_shared` trên `meeting_minutes`, 1 endpoint toggle `PATCH /meeting-minutes/:id/live-share`, mở 1 nhánh đọc cho participant trong `canAccessMinutes()` khi cờ này bật, và phát 3 loại event nhẹ qua `EventsGateway` (`live_started`/`live_stopped`/`updated`) vào room `meeting:${meetingId}` đã có sẵn.

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL + Socket.IO (`@nestjs/websockets`, đã có sẵn qua `EventsGateway`). 1 migration thêm cột, không bảng mới, không gateway mới.

### 2.2 Existing Codebase Analysis
- [meeting-minutes.entity.ts](../../../../src/modules/minutes/entities/meeting-minutes.entity.ts) — entity hiện có, có `visibilityLevel` (KHÔNG tái dùng cho feature này — xem spec.md CHANGELOG đợt 2 giải thích lý do).
- [minutes.service.ts:1174-1198](../../../../src/modules/minutes/services/minutes.service.ts) (`canAccessMinutes`) — hard-code DRAFT chỉ `preparedBy` truy cập được, hoàn toàn không đọc `visibility_level`. Đây là chỗ cần sửa duy nhất cho phần đọc.
- [minutes.service.ts:1200+](../../../../src/modules/minutes/services/minutes.service.ts) (`findMinutesDetail`) — gọi `canAccessMinutes`, không cần sửa gì khác ngoài nhánh trong hàm đó.
- [minutes-list.controller.ts:257](../../../../src/modules/minutes/controllers/minutes-list.controller.ts) (`PATCH :id`, permission `meeting.minutes.update`) — nơi nội dung thực sự được lưu (UC-MKM-04); cần thêm hook emit event `minutes.draft.updated` tại đây sau khi lưu thành công, có điều kiện `isLiveShared`.
- [minutes-list.controller.ts:347](../../../../src/modules/minutes/controllers/minutes-list.controller.ts) (`POST :id/issue`) — cần thêm 1 dòng set `isLiveShared=false` khi issue thành công (FR-014).
- [events.gateway.ts](../../../../src/modules/websocket/events.gateway.ts) — `MEETING_ROOM(meetingId)` helper, `server: Server` (Socket.IO) đã export sẵn, dùng `server.to(MEETING_ROOM(meetingId)).emit(eventName, payload)`. KHÔNG sửa cấu trúc gateway, chỉ inject `EventsGateway` vào `MinutesService`/module và gọi method emit có sẵn hoặc thêm 1 method helper nhỏ `emitToMeetingRoom(meetingId, event, payload)` nếu gateway chưa có sẵn method public tương tự — cần kiểm tra khi code.
- `ParticipantRole.NOTE_TAKER` — **không liên quan tới feature này nữa** (đã loại bỏ ý thư ký), chỉ còn được nhắc trong changelog để giải thích lý do đổi hướng.

### 2.3 Patterns to Follow
- Controller trả `{ success, message, data }`, `@RequirePermissions('meeting.minutes.update')` (tái dùng, không tạo permission mới).
- Ownership check thủ công trong service (`preparedBy === authUser.userId`), throw `ForbiddenException({ error: { code: 'NOT_MINUTES_OWNER' } })` — đúng pattern đã lặp lại nhiều lần trong `minutes.service.ts`.
- Audit log qua `AuditLogsService.logAction(...)` ngoài transaction, best-effort — đúng pattern `createDraft` đã dùng.
- WebSocket event naming `domain.entity.event` (CLAUDE.md mục 12): `minutes.draft.live_started`, `minutes.draft.live_stopped`, `minutes.draft.updated`.

## 3. Scope Confirmation

### 3.1 In Scope
- Migration + entity: thêm `is_live_shared`.
- Endpoint toggle `PATCH /meeting-minutes/:id/live-share`.
- Sửa `canAccessMinutes()` — mở nhánh đọc cho participant khi live-share bật.
- Hook emit event tại `PATCH :id` (nội dung) và `POST :id/issue` (auto tắt cờ).
- Audit log cho hành động toggle.
- Unit test cho toàn bộ nhánh mới.

### 3.2 Out of Scope
Xem spec.md mục 8 — đặc biệt: KHÔNG làm thư ký/multi-writer, KHÔNG đồng bộ nội dung qua WebSocket (chỉ tín hiệu nhẹ), KHÔNG làm FE trong plan này.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS |
| SEC-02 (auth bắt buộc) | PASS — tái dùng JwtAuthGuard/PermissionsGuard/ownership check |
| SEC-03 (input validation) | PASS — DTO `{ enabled: boolean }` + ParseUUIDPipe |
| DATA-01 (soft-delete) | PASS — không đụng cơ chế soft-delete |
| ARCH-01 (module boundary) | PASS — `MinutesService` gọi `EventsGateway` qua DI, không import chéo ngược lại |
| ARCH-02 (async cho >2s) | PASS — toggle + emit là thao tác nhanh, không cần queue |
| ARCH-03 (idempotency) | PASS — so sánh giá trị cũ/mới trước khi update+emit (AC-010) |
| ENG-01 (test coverage) | Áp dụng — mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng — `@ApiOperation`/`@ApiResponse` cho endpoint mới |
| ENG-03 (error không lộ stack trace) | PASS |
| CLAUDE.md mục 12 (WS payload nhỏ) | PASS — chỉ gửi `{minutesId, versionNo, updatedAt}`, không gửi nội dung |
| CLAUDE.md 5.4 (add-only, không bảng mới) | PASS — chỉ thêm 1 cột boolean |

### 3.4 Complexity Tracking
Điểm cần cẩn thận nhất: `canAccessMinutes()` là hàm bảo mật dùng chung cho MỌI lần đọc chi tiết biên bản — sửa sai nhánh DRAFT có thể vô tình mở quyền đọc rộng hơn dự định. Giảm thiểu bằng: điều kiện mới phải VÀ cả 2 vế (`isParticipant && minutes.isLiveShared`), viết test riêng cho trường hợp `isLiveShared=false` vẫn bị chặn đúng như cũ (AC-006) để tránh regression. Không cần ADR — thay đổi cục bộ, dễ kiểm chứng bằng test.

## 4. Data Model Impact
Xem spec.md mục 5. Tóm tắt: 0 bảng mới, **1 cột mới** (`is_live_shared`), 0 permission mới, 0 bảng WS message (event là ephemeral, không lưu DB).

### 4.1 Bảng bị ảnh hưởng (ALTER)
`meeting_minutes` — thêm cột `is_live_shared boolean NOT NULL DEFAULT false`.

### 4.2 Migration
1 migration mới: `AddIsLiveSharedColumnToMeetingMinutes` — thêm cột với default `false` ngay từ đầu (không cần backfill phức tạp như migration `source` trước đó, vì default áp cho toàn bộ dòng cũ là đúng ý nghĩa: dữ liệu cũ chưa từng bật live-share). Có `down()` đầy đủ.

## 5. API / Contract Plan

### 5.1 Endpoint mới
`PATCH /api/v1/meeting-minutes/:id/live-share`

### 5.2 Request
```jsonc
{ "enabled": true }
```

### 5.3 Success Response
`200 OK` — xem spec.md mục 5.3.

### 5.4 Error Responses
`400 VALIDATION_ERROR`, `401 Unauthorized`, `403 NOT_MINUTES_OWNER` / `403 FORBIDDEN`, `404 MEETING_MINUTES_NOT_FOUND`, `409 MINUTES_NOT_DRAFT` / `409 MEETING_NOT_IN_PROGRESS`.

### 5.5 WebSocket Events (không phải REST, ghi chú hợp đồng realtime)
| Event | Room | Payload | Khi nào |
| :--- | :--- | :--- | :--- |
| `minutes.draft.live_started` | `meeting:${meetingId}` | `{ minutesId, versionNo }` | Toggle bật thành công |
| `minutes.draft.live_stopped` | `meeting:${meetingId}` | `{ minutesId }` | Toggle tắt thành công (kể cả tự động khi issue) |
| `minutes.draft.updated` | `meeting:${meetingId}` | `{ minutesId, versionNo, updatedAt }` | Lưu nội dung thành công VÀ đang live-share |

### 5.6 Full Contract
Không tạo file `contracts/` riêng (theo đúng precedent các feature cross-cutting nhẹ như `feat-manual-minutes-parallel-to-ai`) — contract đầy đủ nằm ở spec.md mục 5 + bảng trên.

## 6. Authorization Plan

### 6.1 Permission Design
Không tạo permission mới. Tái dùng `meeting.minutes.update` cho endpoint toggle (cùng permission với `PATCH :id` nội dung). Endpoint đọc `GET :id` tái dùng `meeting.minutes.read` đã có.

### 6.2 Authorization Flow
Toggle: `JwtAuthGuard` → `PermissionsGuard(meeting.minutes.update)` → service kiểm tra `minutes.preparedBy === authUser.userId` (không cho Admin bypass — khác các endpoint khác của module vốn có `isAdmin` bypass, ở đây CỐ Ý không cho Admin toggle hộ Host, vì đây là quyết định điều khiển cá nhân của người đang soạn, không phải quản trị hệ thống).

Đọc: `canAccessMinutes()` — nhánh DRAFT mới:
```ts
if (minutes.status === MeetingMinutesStatus.DRAFT) {
  return minutes.preparedBy === userId || (minutes.isLiveShared && isParticipant);
}
```

### 6.3 Error
Không đổi convention error hiện có.

## 7. Business Logic Plan

### 7.1 Transaction Boundary — endpoint toggle
```text
BEGIN TRANSACTION
  1. SELECT minutes WHERE id=:id AND deletedAt IS NULL FOR UPDATE (lock nhẹ, tránh race 2 request toggle cùng lúc)
  2. Nếu không tồn tại -> 404 MEETING_MINUTES_NOT_FOUND
  3. Nếu preparedBy !== authUser.userId -> 403 NOT_MINUTES_OWNER
  4. Nếu status !== DRAFT -> 409 MINUTES_NOT_DRAFT
  5. Nếu dto.enabled === true:
       SELECT meeting WHERE id=minutes.meetingId
       Nếu meeting.status !== IN_PROGRESS -> 409 MEETING_NOT_IN_PROGRESS
  6. Nếu minutes.isLiveShared === dto.enabled -> COMMIT sớm, trả 200 không đổi gì, KHÔNG emit (idempotent, AC-010)
  7. UPDATE minutes SET is_live_shared = dto.enabled
COMMIT
Ngoài transaction (best-effort):
  8. INSERT audit_logs (action_type='meeting_minutes_live_share_toggled')
  9. emit event tương ứng (live_started nếu bật, live_stopped nếu tắt) qua EventsGateway
```

### 7.2 Hook tại `PATCH :id` (nội dung, UC-MKM-04) — sửa nhỏ
Sau khi `save()` nội dung thành công (đã có sẵn trong `updateDraft`): nếu `savedMinutes.isLiveShared === true`, gọi `eventsGateway.emitToMeetingRoom(meetingId, 'minutes.draft.updated', { minutesId, versionNo, updatedAt })` — best-effort, không rollback nếu emit lỗi (FR error 6.5).

### 7.3 Hook tại `POST :id/issue` — sửa nhỏ
Trong transaction issue hiện có, nếu `minutes.isLiveShared === true` trước khi issue: set `isLiveShared = false` cùng lúc với việc set `status = published`; sau transaction, emit `minutes.draft.live_stopped` (best-effort) — đúng FR-014.

### 7.4 `canAccessMinutes()` — sửa nhánh DRAFT
Xem mục 6.2. Chỉ thêm 1 điều kiện OR, không đổi nhánh PUBLISHED/ARCHIVED.

### 7.5 State Machine
`is_live_shared`: `false → true → false` (Host tự bật/tắt tuỳ ý trong lúc draft) → `false` cố định vĩnh viễn sau khi issue (không có transition ngược).

### 7.6 Key Business Rules Implemented
FR-002, FR-003, FR-004, FR-005, FR-006, FR-008, FR-010, FR-014 (xem spec.md mục 3).

## 8. Validation Plan

### 8.1 Input Validation (DTO)
`ToggleLiveShareMinutesDto`: `enabled: boolean` — `@IsBoolean()`, bắt buộc (không optional, tránh nhầm lẫn "không truyền = giữ nguyên" — client luôn phải nói rõ ý định).

### 8.2 Business Validation (Service)
Theo đúng thứ tự mục 7.1.

## 9. Error Handling Plan

### 9.1 Exception Mapping
| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Không tìm thấy minutes | `NotFoundException` | `MEETING_MINUTES_NOT_FOUND` |
| Không phải preparedBy | `ForbiddenException` | `NOT_MINUTES_OWNER` |
| Không phải trạng thái draft | `ConflictException` | `MINUTES_NOT_DRAFT` |
| Meeting không in_progress (khi bật) | `ConflictException` | `MEETING_NOT_IN_PROGRESS` |

### 9.2 Transaction Error Handling
Lỗi nghiệp vụ throw trong transaction tự rollback (TypeORM). Lỗi emit WebSocket KHÔNG rollback (best-effort, ngoài transaction).

### 9.3 Notification Error (Non-blocking)
Không áp dụng — feature này cố ý không tạo notification (FR-018).

## 10. Testing Strategy

### 10.1 Unit Tests
- `minutes.service.spec.ts`: toggle bật thành công + emit đúng event (AC-001); toggle tắt (AC-004); toggle bởi không phải preparedBy → 403 (AC-005); toggle khi không phải draft → 409 (AC-007); bật khi meeting không in_progress → 409 (AC-008); toggle lặp lại cùng giá trị → không emit thêm (AC-010); `canAccessMinutes` cho participant khi `isLiveShared=true` → đọc được (AC-003); khi `isLiveShared=false` → vẫn bị chặn như cũ (AC-006, **quan trọng nhất — chống regression**); issue tự tắt cờ (AC-009); `PATCH :id` nội dung khi đang live-share → có emit `minutes.draft.updated` (AC-002); khi không live-share → không emit gì (FR-007).

### 10.2 Integration Test Ideas
(Ghi chú cho tương lai) Kết nối Socket.IO client thật, subscribe room `meeting:${meetingId}`, gọi toggle qua HTTP, assert client nhận đúng event — cần môi trường test có WS server thật, không bắt buộc trong phạm vi PR này (mock `EventsGateway` đủ cho unit test).

### 10.3 Migration Test
Không bắt buộc unit test riêng — verify thủ công `migration:run`/`migration:revert` trên DB dev, kiểm tra default `false` áp đúng cho toàn bộ dòng cũ.

## 11. Implementation Phases

### Phase 1: Schema
Migration + cập nhật `MeetingMinutesEntity`.

### Phase 2: Toggle endpoint
DTO, service method, controller route, permission (tái dùng).

### Phase 3: Read-gate + hooks
Sửa `canAccessMinutes()`; thêm hook emit tại `PATCH :id` và `POST :id/issue`.

### Phase 4: DTO expose + Tests
Thêm `isLiveShared` vào `MinutesDetailResponseDto`; viết đủ test; chạy lint/build/test.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Sửa `canAccessMinutes()` sai, vô tình mở quyền đọc rộng hơn dự định cho DRAFT | Điều kiện AND chặt (`isParticipant && isLiveShared`), viết test riêng khẳng định hành vi cũ không đổi khi cờ tắt (AC-006) |
| `EventsGateway.server` chưa khởi tạo xong tại thời điểm `MinutesService` gọi emit (thứ tự bootstrap module) | Bọc emit trong try/catch, log lỗi, không throw — best-effort đúng như đã ghi ở mục 9.2; nếu lỗi lặp lại thường xuyên khi test thật, cân nhắc emit qua EventEmitter nội bộ (`@nestjs/event-emitter`) thay vì gọi trực tiếp gateway — để ngỏ, quyết định khi code thực tế nếu phát sinh |
| Host quên tắt live-share sau khi họp kết thúc, participant cũ vẫn đọc được nháp qua REST | Chấp nhận có chủ đích (xem spec.md mục 1.5) — phạm vi người đọc được vẫn giới hạn đúng participant của meeting đó, không phải rò rỉ ra ngoài; tắt tự động theo trạng thái meeting để lại cho feature tương lai nếu cần (mục 8.2) |
| Toggle nhiều lần rất nhanh (double-click) gây phát trùng event dù đã có check idempotent ở tầng service | Lock nhẹ dòng minutes trong transaction (`FOR UPDATE`) đã đủ serialize 2 request gần như đồng thời — request thứ 2 đọc được giá trị đã cập nhật của request thứ 1, tự nhiên rơi vào nhánh idempotent |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.6.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md` — không tạo `research.md`/`data-model.md`/`contracts/`/`quickstart.md` riêng, theo đúng precedent `feat-manual-minutes-parallel-to-ai`.
