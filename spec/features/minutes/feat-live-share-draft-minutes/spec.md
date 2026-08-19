# Feature Specification: Chia sẻ trực tiếp biên bản nháp trong lúc họp (Live-Share Draft Minutes)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-19 | Khởi tạo spec. Mã **MKM-LIVE-01**, không có UC gốc trong Feature Table — bổ sung theo yêu cầu Product Owner sau khi bàn về biên bản thủ công song song (MKM-MANUAL-01). Ban đầu Thiếu Chủ đề xuất 3 ý: (1) Host phân công thư ký, (2) soạn real-time trong lúc họp, (3) toggle chia sẻ bản đang soạn cho cả phòng xem real-time. Khảo sát code phát hiện: UC-MKM-01 gốc **đã cho phép** tạo/sửa biên bản khi `meeting.status=in_progress` (ý #2 đã có sẵn); `ParticipantRole.NOTE_TAKER` đã có trong enum và đã được đọc/hiển thị trong `MinutesDetailResponseDto.generalInfo.noteTaker`, nhưng chưa có endpoint gán vai trò và `canEditOrIssue` chưa cấp quyền sửa cho note_taker. Sau trao đổi, Thiếu Chủ **chốt bỏ hẳn ý #1 (thư ký)** — chỉ Host được soạn, đơn giản hoá đáng kể (không cần giải quyết multi-writer conflict). Spec này chỉ còn phạm vi ý #3. | Toàn bộ file |
| 2026-08-19 | Đào sâu thêm trước khi chốt thiết kế: phát hiện `canAccessMinutes()` hiện **hard-code** DRAFT chỉ cho `preparedBy` truy cập, hoàn toàn không đọc cột `visibility_level` — đề xuất ban đầu "tái dùng visibility_level" (đã nói trong chat) **sẽ KHÔNG hoạt động** nếu không sửa thêm `canAccessMinutes`. Ngoài ra `visibility_level` vốn mang ý nghĩa khác (phạm vi hiển thị SAU KHI ban hành), tái dùng cho khái niệm "đang chia sẻ live lúc còn nháp" sẽ gây lẫn lộn 2 vòng đời khác nhau. **Đổi hướng: thêm 1 cột mới `is_live_shared` (boolean) tách biệt hoàn toàn**, không đụng tới `visibility_level`. Cập nhật toàn bộ mục 3, 5. | Mục 3, 5 |

> Nguồn gốc: không có UC gốc — bổ sung trực tiếp từ Product Owner. Mở rộng UC-MKM-01 (tạo biên bản nháp, vốn đã cho phép soạn khi `in_progress`) và tương tác với `feat-update-draft-meeting-minutes` (UC-MKM-04, nơi nội dung thực sự được lưu) + `feat-issue-meeting-minutes`. Không phụ thuộc MKM-MANUAL-01/MKM-AI-01 — áp dụng cho bất kỳ biên bản nháp nào (`status=draft`), không phân biệt `source`.

## 1. Context & Goal

### 1.1 Bối cảnh
UC-MKM-01 đã cho phép Host tạo và soạn biên bản (`status=draft`) ngay trong lúc cuộc họp đang diễn ra (`meeting.status=in_progress`), nhưng bản nháp mặc định **chỉ Host nhìn thấy** (`canAccessMinutes()` hard-code DRAFT = chỉ `preparedBy`). Không ai khác trong phòng họp biết Host đang ghi gì, phải chờ đến khi ban hành (issue) mới xem được.

### 1.2 Mục tiêu
Cho phép Host **tự bật/tắt** chế độ "chia sẻ trực tiếp" cho bản nháp đang soạn: khi bật, mọi participant của cuộc họp có thể **xem (read-only)** nội dung nháp cập nhật gần như tức thời qua kênh realtime đã có sẵn (`EventsGateway`), không cần đợi ban hành. Chỉ Host được soạn — không có khái niệm đồng biên tập nhiều người trong phạm vi feature này.

### 1.3 Giá trị mang lại
- Người tham dự theo dõi được nội dung đang được ghi nhận ngay trong cuộc họp, tăng minh bạch, có thể phản hồi/nhắc Host bổ sung ngay tại chỗ thay vì chờ ban hành.
- Tận dụng đúng hạ tầng WebSocket (`EventsGateway`, room `meeting:${meetingId}`) đã có sẵn cho nhiều tính năng khác (guest access, IVSS) — không cần dựng kênh realtime mới.

### 1.4 Giả định
- Chỉ Host (`meeting.hostId`) mới bật/tắt được chia sẻ trực tiếp và mới được sửa nội dung — participant xem read-only tuyệt đối, không có API ghi nào mở thêm cho họ.
- "Người tham dự" ở đây là `meeting_participants` của đúng meeting đó (không mở cho người ngoài) — tái dùng đúng khái niệm `isParticipant` đã có trong `canAccessMinutes()`.
- Kênh phát tin nhắn nhẹ (chỉ `minutesId`/`versionNo`/`updatedAt`), FE tự gọi REST `GET /meeting-minutes/:id` để lấy nội dung mới nhất — đúng convention CLAUDE.md mục 12 ("payload nhỏ, không gửi object lớn qua WebSocket").
- Chỉ áp dụng cho bản nháp (`status=draft`); khi ban hành (issue), cờ tự tắt — vòng đời chia sẻ SAU khi ban hành đã có cơ chế riêng (`visibility_level`, `feat-share-meeting-minutes`), không liên quan tới feature này.

### 1.5 Cần làm rõ
- [NEEDS CLARIFICATION] Chỉ giới hạn bật được khi `meeting.status=in_progress` (đúng tinh thần "đang họp") — nếu Host cố bật khi meeting đã `completed`, spec này từ chối (xem FR-006). Nếu về sau có nhu cầu bật cả khi đã kết thúc (ví dụ để rà lại nội dung cùng nhau ngay sau khi họp xong), cần yêu cầu rõ ràng, ngoài phạm vi hiện tại.
- [NEEDS CLARIFICATION] Nếu Host quên tắt và cuộc họp kết thúc/participant rời phòng, cờ `is_live_shared` vẫn giữ `true` cho tới khi Host tắt tay hoặc ban hành biên bản — chấp nhận rủi ro nhỏ này (participant cũ vẫn xem được qua REST nếu họ chủ động gọi lại) thay vì làm phức tạp thêm bằng cách tự động tắt theo trạng thái meeting (xem plan.md mục 12 — Risk).

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Host của cuộc họp (đồng thời là `minutes.preparedBy` — chỉ Host mới tạo được nháp theo UC-MKM-01).
- **Secondary Actor**: Participant của cuộc họp — chỉ đọc (read-only viewer), không có quyền ghi nào.

### 2.2 Role & Permission Rules
- Không tạo permission mới — tái dùng nguyên vẹn `meeting.minutes.update` (đúng permission của endpoint `PATCH /meeting-minutes/:id` nội dung, vì bật/tắt live-share về bản chất là 1 hành động cập nhật trên chính bản nháp đó) cho endpoint toggle.
- Endpoint đọc (`GET /meeting-minutes/:id`) tái dùng nguyên vẹn `meeting.minutes.read` đã có — chỉ sửa logic NỘI BỘ (`canAccessMinutes`) để mở thêm 1 nhánh cho participant khi `is_live_shared=true`, không đổi permission code nào.

### 2.3 Actor Constraints
- Người không phải `preparedBy` (kể cả Organizer, participant khác) không được bật/tắt live-share — kể cả Admin (giữ đúng nguyên tắc "chỉ Host soạn/điều khiển nháp của chính họ", nhất quán với UC-MKM-04).
- Participant xem được nội dung nháp khi live-share bật, nhưng **không** có quyền gọi `PATCH`/`issue`/`delete` trên bản ghi đó — các permission/ownership check hiện có của những endpoint đó giữ nguyên, không đổi.

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép 1 bản ghi `meeting_minutes` mang cờ `is_live_shared` (boolean, mặc định `false`), độc lập hoàn toàn với `visibility_level` (không tái dùng, không đổi ý nghĩa cột đó).
- **FR-002**: THE system SHALL chỉ cho phép bật/tắt `is_live_shared` khi bản ghi đang ở trạng thái `draft`.
- **FR-003**: THE system SHALL chỉ cho phép `preparedBy` của chính bản ghi đó bật/tắt `is_live_shared` — không mở cho Admin/Organizer/participant khác.

### 3.2 Event-driven Requirements
- **FR-004**: WHEN Host gọi bật `is_live_shared` (từ `false` → `true`) thành công, THE system SHALL phát 1 event WebSocket `minutes.draft.live_started` vào room `meeting:${meetingId}` với payload tối giản `{ minutesId, versionNo }`.
- **FR-005**: WHEN Host gọi tắt `is_live_shared` (từ `true` → `false`), THE system SHALL phát event `minutes.draft.live_stopped` vào cùng room với payload `{ minutesId }`.
- **FR-006**: WHEN nội dung bản nháp được lưu thành công qua `PATCH /meeting-minutes/:id` (UC-MKM-04) VÀ `is_live_shared=true` tại thời điểm lưu, THE system SHALL phát event `minutes.draft.updated` vào room `meeting:${meetingId}` với payload `{ minutesId, versionNo, updatedAt }` — KHÔNG gửi nguyên nội dung `minutesContent`/`decisionsJson`/`actionItemsJson` qua WebSocket.
- **FR-007**: WHEN nội dung được lưu VÀ `is_live_shared=false`, THE system SHALL NOT phát bất kỳ event WebSocket nào (giữ đúng hành vi im lặng hiện tại của UC-MKM-04).

### 3.3 State-driven Requirements
- **FR-008**: WHILE `is_live_shared=true` VÀ `minutes.status=draft`, THE system SHALL cho phép participant của đúng meeting đó gọi `GET /meeting-minutes/:id` thành công (read-only) — mở rộng nhánh DRAFT của `canAccessMinutes()`.
- **FR-009**: WHILE `is_live_shared=false` (mặc định), THE system SHALL giữ nguyên hành vi cũ: chỉ `preparedBy` (hoặc Admin) đọc được bản nháp — không có thay đổi hành vi so với trước feature này.

### 3.4 Optional Feature Requirements
- **FR-010**: WHERE Host bật live-share khi `meeting.status != in_progress`, THE system SHALL từ chối với lỗi nghiệp vụ rõ ràng (xem mục 6) — chỉ cho bật khi cuộc họp đang thực sự diễn ra.

### 3.5 Unwanted Behavior Requirements
- **FR-011**: IF người gọi endpoint toggle không phải `preparedBy`, THEN THE system SHALL từ chối 403 `NOT_MINUTES_OWNER` (tái dùng đúng error code đã dùng ở các endpoint khác của module minutes).
- **FR-012**: IF bản ghi không còn ở trạng thái `draft` (đã `published`/`archived`/`deleted`), THEN THE system SHALL từ chối 409 `MINUTES_NOT_DRAFT` khi gọi toggle.
- **FR-013**: IF participant gọi `GET /meeting-minutes/:id` cho 1 bản nháp có `is_live_shared=false`, THEN THE system SHALL từ chối 403 `MEETING_MINUTES_ACCESS_DENIED` — giữ nguyên hành vi bảo mật mặc định.

### 3.6 Workflow Requirements
- **FR-014**: THE system SHALL tự động đặt `is_live_shared=false` khi biên bản được ban hành (issue) thành công — vòng đời chia sẻ sau ban hành do `visibility_level`/`feat-share-meeting-minutes` đảm nhiệm, không chồng lấn với cờ này.

### 3.7 Data & State Requirements
- **FR-015**: THE system SHALL thêm cột `is_live_shared` (boolean, NOT NULL, default `false`) vào bảng `meeting_minutes` qua 1 migration duy nhất — không tạo bảng mới.
- **FR-016**: `MinutesDetailResponseDto` SHALL expose `isLiveShared: boolean` để FE hiển thị trạng thái (badge "Đang chia sẻ trực tiếp").

### 3.8 Notification / Audit Requirements
- **FR-017**: THE system SHALL ghi 1 bản ghi `audit_logs` khi bật/tắt live-share (`action_type='meeting_minutes_live_share_toggled'`, metadata `{ minutesId, enabled }`) — nhất quán với cách các hành động khác của module minutes đều có audit log.
- **FR-018**: THE system SHALL NOT gửi notification (email/in-app) khi bật/tắt live-share hoặc khi có event `minutes.draft.updated` — đây là kênh realtime tức thời cho người đang mở phòng họp, không phải notification cần lưu trữ/đọc sau.

### 3.9 Complex / Combined Requirements
- **FR-019**: IF `is_live_shared=true` AND Host lưu nội dung nhiều lần liên tiếp trong thời gian ngắn, THEN mỗi lần lưu thành công đều phát đúng 1 event `minutes.draft.updated` — không cần debounce/throttle ở tầng backend trong phạm vi v1 (chấp nhận có thể phát nhiều event gần nhau nếu Host lưu nhanh liên tục; debounce nếu cần sẽ làm ở tầng FE khi tự quyết định lúc nào gọi lại REST).

### 3.10 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-015 | Quyết định đổi hướng (đợt 2, xem CHANGELOG) — cột riêng thay vì tái dùng `visibility_level` |
| FR-002, FR-003, FR-011, FR-012 | Yêu cầu "chỉ Host soạn/điều khiển" (chốt bỏ thư ký) |
| FR-004, FR-005, FR-006, FR-007, FR-019 | Ý #3 gốc — "chia sẻ trực tiếp, real-time" |
| FR-008, FR-009, FR-013 | Khảo sát `canAccessMinutes()` hard-code DRAFT=preparedBy-only |
| FR-010 | Giả định 1.5 — chỉ bật khi đang họp |
| FR-014 | Giả định 1.4 — không chồng lấn với vòng đời share sau ban hành |
| FR-016, FR-017, FR-018 | Convention chung của module minutes (audit log, DTO expose field) |

## 4. Non-functional Requirements

### 4.1 Performance
Toggle + phát event phải hoàn tất trong 1 request đồng bộ (< 300ms) — không cần queue/background_jobs vì đây là thao tác nhẹ, không xử lý AI/file.

### 4.2 Security
- Không mở thêm bề mặt ghi dữ liệu nào cho participant — chỉ nới đúng 1 nhánh ĐỌC trong `canAccessMinutes()`, có điều kiện chặt (`isParticipant && isLiveShared`).
- WebSocket room `meeting:${meetingId}` đã có auth handshake sẵn (theo comment trong `events.gateway.ts` về GLA-001) — tái dùng nguyên vẹn, không tự ý nới lỏng auth của gateway.

### 4.3 Reliability & Consistency
Idempotency tự nhiên: gọi toggle với giá trị hiện tại (vd bật khi đã bật) — service trả về thành công không đổi gì và không phát event trùng (so sánh giá trị cũ/mới trước khi update + emit).

### 4.4 Usability
FE nhận `minutes.draft.updated` chỉ như 1 tín hiệu "có gì mới" — không bắt buộc gọi lại REST ngay lập tức, có thể debounce phía client để tránh gọi API dồn dập nếu Host gõ liên tục (đúng tinh thần FR-019).

### 4.5 Observability
Log rõ `minutesId`, `meetingId`, `preparedBy`, hành động bật/tắt, và số lượng client đang subscribe room đó (nếu `EventsGateway` đã có sẵn cơ chế đếm — tận dụng, không tự thêm mới nếu chưa có).

### 4.6 Maintainability
Logic toggle + audit nằm trong `MinutesService` (đúng module boundary); việc emit event gọi qua `EventsGateway` đã có, không tạo gateway/module mới.

## 5. Data Model

### 5.1 Entity liên quan
- `MeetingMinutesEntity` — **thêm 1 cột mới** `isLiveShared`.
- `EventsGateway` (`src/modules/websocket/events.gateway.ts`) — dùng để `server.to(MEETING_ROOM(meetingId)).emit(...)`, không sửa cấu trúc gateway, chỉ gọi thêm.
- `AuditLogEntity` — ghi 1 dòng mỗi lần toggle.

### 5.2 Thay đổi Entity
```ts
// Thêm vào MeetingMinutesEntity, cạnh visibilityLevel:
@Column({ name: 'is_live_shared', type: 'boolean', default: false })
isLiveShared: boolean;
```

### 5.3 API mới — `PATCH /meeting-minutes/:id/live-share`
Request:
```jsonc
{ "enabled": true } // hoặc false
```
Response `200`:
```jsonc
{
  "success": true,
  "message": "Da bat che do chia se truc tiep",
  "data": { "id": "uuid", "isLiveShared": true, "versionNo": 3 }
}
```

### 5.4 State / Status Model
Không đổi `meeting_minutes.status`. `is_live_shared` là cờ độc lập, chỉ có ý nghĩa khi `status=draft`; tự động `false` khi status chuyển sang `published` (FR-014).

### 5.5 Data Constraints
`is_live_shared` NOT NULL default `false` — không cần unique/index riêng (không phải khóa nghiệp vụ, chỉ là cờ trạng thái đơn).

### 5.6 Data Lifecycle
`false` (mặc định lúc tạo) → Host tự bật/tắt nhiều lần trong lúc `draft` → tự động `false` khi issue (không bao giờ `true` trở lại cho bản ghi đã published/archived).

### 5.7 Data-related EARS Requirements
Xem FR-001, FR-002, FR-014, FR-015.

## 6. Error Handling

### 6.1 Validation Errors
`enabled` không phải boolean → 400 `VALIDATION_ERROR`. `id` không phải UUID hợp lệ → 400 (`ParseUUIDPipe`).

### 6.2 Authentication / Authorization Errors
Không có JWT → 401. Thiếu permission `meeting.minutes.update` → 403 `FORBIDDEN`. Có permission nhưng không phải `preparedBy` → 403 `NOT_MINUTES_OWNER`.

### 6.3 Business Rule Errors
- Bản ghi không ở trạng thái `draft` → 409 `MINUTES_NOT_DRAFT`.
- Meeting không ở trạng thái `in_progress` khi cố BẬT (không áp dụng khi TẮT — luôn cho tắt bất kể trạng thái meeting, để Host không bị kẹt) → 409 `MEETING_NOT_IN_PROGRESS`.

### 6.4 Conflict Errors
Không áp dụng (không có race condition đáng kể — boolean toggle không cần optimistic lock theo `versionNo`).

### 6.5 Integration / External Service Errors
Nếu `EventsGateway.server` chưa sẵn sàng/lỗi khi emit — THE system SHALL log lỗi nhưng KHÔNG rollback transaction toggle (best-effort, giống pattern `AuditLogsService` không chặn business flow đã dùng ở các nơi khác trong module).

### 6.6 Error Response Expectations
Theo đúng format chuẩn dự án, không đổi.

## 7. Acceptance Criteria

### 7.1 Happy Path
- **AC-001**: GIVEN biên bản `M` (`status=draft`, `preparedBy=Host`, meeting `in_progress`), WHEN Host gọi `PATCH :id/live-share {enabled:true}`, THEN trả 200, `isLiveShared=true`, có 1 event `minutes.draft.live_started` phát vào room `meeting:${meetingId}`.
- **AC-002**: GIVEN `M.isLiveShared=true`, WHEN Host lưu nội dung qua `PATCH :id` (UC-MKM-04), THEN có 1 event `minutes.draft.updated` phát kèm `versionNo` mới.
- **AC-003**: GIVEN `M.isLiveShared=true`, WHEN 1 participant (không phải Host) của meeting gọi `GET /meeting-minutes/M`, THEN trả 200 (đọc được), response không chứa field ghi/permission edit nào cho họ.
- **AC-004**: GIVEN `M.isLiveShared=true`, WHEN Host gọi `PATCH :id/live-share {enabled:false}`, THEN trả 200, `isLiveShared=false`, phát event `minutes.draft.live_stopped`.

### 7.2 Authorization Cases
- **AC-005**: GIVEN participant (không phải preparedBy) gọi toggle, WHEN gọi API, THEN trả 403 `NOT_MINUTES_OWNER`.
- **AC-006**: GIVEN `M.isLiveShared=false`, WHEN participant gọi `GET /meeting-minutes/M`, THEN trả 403 `MEETING_MINUTES_ACCESS_DENIED` — hành vi giữ nguyên như trước feature này.

### 7.3 Business Rule Cases
- **AC-007**: GIVEN biên bản `M` đã `published`, WHEN Host gọi toggle, THEN trả 409 `MINUTES_NOT_DRAFT`.
- **AC-008**: GIVEN meeting của `M` đang `scheduled` (chưa bắt đầu), WHEN Host cố BẬT live-share, THEN trả 409 `MEETING_NOT_IN_PROGRESS`.
- **AC-009**: GIVEN `M.isLiveShared=true` VÀ Host ban hành (issue) `M` thành công, THEN sau đó `M.isLiveShared=false` (tự động).

### 7.4 Idempotency Cases
- **AC-010**: GIVEN `M.isLiveShared=true`, WHEN Host gọi lại toggle `{enabled:true}` (đã bật sẵn), THEN trả 200 nhưng KHÔNG phát thêm event `minutes.draft.live_started` mới.

### 7.5 Notification / Audit Cases
- **AC-011**: GIVEN toggle thành công (bật hoặc tắt), THEN có đúng 1 bản ghi `audit_logs` mới `action_type='meeting_minutes_live_share_toggled'`.
- **AC-012**: GIVEN bất kỳ hành động nào ở feature này, THEN KHÔNG có notification (email/in-app) nào được tạo.

### 7.6 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001, AC-004 | FR-002, FR-003, FR-004, FR-005 |
| AC-002 | FR-006 |
| AC-003, AC-006 | FR-008, FR-009, FR-013 |
| AC-005 | FR-011 |
| AC-007, AC-008 | FR-012, FR-010 |
| AC-009 | FR-014 |
| AC-010 | NFR 4.3 (idempotency) |
| AC-011, AC-012 | FR-017, FR-018 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Thư ký/note_taker cùng soạn — **đã bị loại bỏ khỏi phạm vi theo quyết định của Thiếu Chủ**, không làm trong feature này lẫn tương lai gần.
- Collaborative editing nhiều người cùng gõ 1 lúc (CRDT/Operational Transform) — không cần vì chỉ Host soạn.
- Đồng bộ nội dung real-time từng ký tự qua WebSocket — chỉ phát tín hiệu "có bản mới", FE tự gọi REST lấy nội dung đầy đủ.
- FE implementation — spec/plan/tasks này chỉ phạm vi backend; FE (hiển thị badge live, subscribe socket, banner cho participant) sẽ làm ở bước riêng sau khi BE xong, theo đúng trình tự đã áp dụng cho MKM-MANUAL-01.
- Tự động tắt `is_live_shared` khi meeting kết thúc/participant rời phòng — chấp nhận rủi ro nhỏ đã nêu ở mục 1.5, không làm phức tạp thêm bằng hook liên module.

### 8.2 Có thể xem xét ở feature khác
- FE cho tính năng này (`feat-live-share-draft-minutes-fe` hoặc gộp thẳng vào task FE khi được yêu cầu).
- Tự động tắt live-share khi live-meeting chuyển trạng thái `ended` (nếu sau này thấy cần) — thuộc phạm vi module `live-meeting`, cần thiết kế hook riêng.

### 8.3 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT cho phép bất kỳ ai ngoài `preparedBy` sửa nội dung bản nháp, kể cả khi `is_live_shared=true`.
- **FR-OOS-002**: THE system SHALL NOT gửi nguyên nội dung biên bản (`minutesContent`/`decisionsJson`/`actionItemsJson`) qua WebSocket payload.
- **FR-OOS-003**: THE system SHALL NOT tạo bảng mới, không tạo permission mới cho feature này.

## Assumptions
Xem mục 1.4.
