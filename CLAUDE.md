# CLAUDE.md - Backend Guide cho Smart Meeting Management & AI Meeting Intelligence Platform v1.1

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | - Cập nhật Database lên v3.2 Compact (39 bảng), xóa `user_sessions`.<br>- Thêm luật ghi log thay đổi ở đầu mọi file `.md`.<br>- Thêm luật BẮT BUỘC phải đọc CLAUDE.md/AGENTS.md trước khi code. | Các dòng liên quan DB, phần TL;DR và Authentication |

> File này là tài liệu định hướng cho Claude Code / coding agent khi làm việc với **backend** của dự án.  
> Mục tiêu: giúp agent hiểu đúng domain, kiến trúc, database, module boundary, convention code, API style và các giới hạn quan trọng trước khi sinh code.

---

## 0. TL;DR - Đọc trước trong 60 giây

Đây là backend cho hệ thống **Intelligent Meeting Lifecycle Management System**: nền tảng quản lý toàn bộ vòng đời cuộc họp cho doanh nghiệp/tổ chức.

Hệ thống bao phủ:

- Xác thực, phân quyền, tài khoản người dùng.
- Tạo, cập nhật, hủy, duyệt và quản lý cuộc họp.
- Kiểm tra xung đột lịch, gợi ý thời gian/phòng họp.
- Đặt phòng, theo dõi sử dụng phòng, phát hiện no-show, auto-release phòng.
- Quản lý phòng họp, ghế ngồi, thiết bị, camera, microphone, IoT device.
- Điểm danh, presence detection, check-in/check-out.
- Điều khiển phiên họp đang diễn ra: start, pause, resume, extend, end.
- Ghi âm/ghi hình, quản lý media, recording session, recording segment.
- Quản lý transcript, minutes, action items, documents.
- Notification, reporting, analytics, audit log, system configuration.

Dự án này **không phải chỉ là app lịch họp**.  
Dự án này **không phải chỉ là app AI note-taking**.  
Đây là hệ thống vận hành nội bộ cho meeting lifecycle end-to-end.

Backend sử dụng:

- **NestJS** làm backend framework.
- **PostgreSQL** làm database chính.
- **TypeORM** làm ORM/migration layer, trừ khi team thay đổi chính thức.
- **JWT + RBAC** cho authentication/authorization.
- **WebSocket** cho realtime status/presence/live meeting sync.
- **HTTP Subscription** (từ Door Face Attendance Terminal) và **RTSP qua Python Camera Service** (từ IP Room Camera) cho camera integration trong v1. MQTT không được dùng trong v1 core flow.

Nguyên tắc quan trọng nhất:

> Không tự ý mở rộng scope, không tự ý thêm bảng, không tự ý thêm AI/vector/embedding pipeline, không tự ý thay đổi database baseline nếu không có yêu cầu rõ ràng.

---

## 1. Vai trò của file CLAUDE.md và Quy tắc bắt buộc

**[RULE TỐI THƯỢNG 1] BẮT BUỘC ĐỌC TÀI LIỆU**: Mọi AI Agent ĐỀU PHẢI đọc toàn bộ nội dung của file `CLAUDE.md` (và/hoặc `AGENTS.md`) trước khi bắt đầu bất kỳ công việc nào (lên plan, code, test) trong dự án này. Đây là bước kiểm tra bắt buộc, nếu chưa đọc thì không được phép suy đoán cấu trúc dự án.

**[RULE TỐI THƯỢNG 2] GHI LOG KHI SỬA FILE MARKDOWN**: Bất cứ sự sửa đổi nào ở MỌI file `.md` trong dự án (bao gồm `CLAUDE.md`, `AGENTS.md`, các file `spec.md`, `plan.md`, `tasks.md`, `research.md`...) đều **PHẢI** ghi thêm 1 dòng log vào phần "CHANGELOG & REVISION HISTORY" ở ngay đầu trang của file đó.
Nội dung log phải có: Ngày thay đổi, Tóm tắt nội dung thay đổi, Vị trí/Các dòng thay đổi. Luật này giúp lưu vết tự động để agent khác và team dễ theo dõi.

File này dùng để hướng dẫn agent khi:

- Tạo module NestJS mới.
- Viết controller/service/repository/entity/DTO.
- Tạo migration database.
- Viết API endpoint.
- Kiểm tra logic nghiệp vụ.
- Refactor backend.
- Sinh test.
- Làm việc theo use case/spec/API contract.

Khi có mâu thuẫn giữa các nguồn tài liệu, ưu tiên theo thứ tự:

1. **Yêu cầu trực tiếp mới nhất của người dùng/team.**
2. **Database v3.2 Compact hiện tại** (39 bảng, loại bỏ user_sessions).
3. **Feature Table mới nhất** của dự án.
4. **Use Case Specification mới nhất**.
5. **API Contract mới nhất**.
6. **Tài liệu trong `/spec`**.
7. **File CLAUDE.md này**.
8. Code hiện tại trong `/src`.

Nếu code hiện tại khác spec/database chính thức, không mặc định code là đúng. Hãy báo rõ sự lệch và đề xuất cách sửa an toàn.

---

## 2. Product Scope chính xác

### 2.1. Mục tiêu sản phẩm

Hệ thống giúp tổ chức quản lý meeting lifecycle từ trước, trong và sau cuộc họp:

1. **Trước cuộc họp**
   - Tạo yêu cầu họp.
   - Kiểm tra lịch bận/xung đột.
   - Đặt phòng phù hợp.
   - Phê duyệt nếu cần.
   - Mời người tham gia.
   - Gửi thông báo/reminder.

2. **Trong cuộc họp**
   - Check-in/check-out.
   - Theo dõi presence.
   - Xác định phòng đang sử dụng hay bị no-show.
   - Điều khiển trạng thái họp.
   - Ghi âm/ghi hình nếu được bật.
   - Nhận tín hiệu từ IoT/camera/microphone/capture agent.

3. **Sau cuộc họp**
   - Lưu recording/media.
   - Lưu transcript nếu có.
   - Quản lý minutes.
   - Quản lý action items.
   - Gửi outcome notification.
   - Báo cáo hiệu suất sử dụng phòng/họp.
   - Audit và truy vết.

### 2.2. Giá trị cốt lõi

- Giảm thao tác thủ công khi tạo và điều phối họp.
- Giảm lãng phí phòng họp, no-show, phantom booking.
- Tăng khả năng kiểm soát, phê duyệt, audit.
- Chuẩn hóa dữ liệu cuộc họp.
- Biến nội dung họp thành tri thức có thể tái sử dụng khi phần AI/document được bật trong tương lai.

### 2.3. Điều không được hiểu sai

Không được biến hệ thống thành:

- App calendar đơn giản.
- App đặt phòng đơn giản.
- App AI transcript đơn giản.
- App task management độc lập.
- App quản lý thiết bị IoT độc lập.
- App chat/collaboration thay thế Slack/Teams.

Mọi tính năng phải phục vụ meeting lifecycle.

---

## 3. Tech Stack Backend

### 3.1. Stack chính

<<<<<<< HEAD
| Thành phần | Công nghệ đề xuất | Ghi chú |
|---|---|---|
| Runtime | Node.js LTS | Không dùng API experimental nếu không cần |
| Framework | NestJS | Modular monolith trước, microservice sau nếu cần |
| Language | TypeScript | Bắt buộc strict typing |
| Database | PostgreSQL | UUID primary key, timestamptz |
| ORM | TypeORM | Entity + migration rõ ràng |
| Auth | JWT | Access token + refresh token nếu scope yêu cầu |
| Authorization | RBAC | roles, permissions, guards |
| Realtime | WebSocket Gateway | Room status, meeting status, presence |
| Device event ingestion | HTTP callbacks + REST API | Face Server uses HTTP Subscription; Python Camera Service sends room camera events to NestJS through REST API |
| MQTT | Future extension only | Not used in v1; only considered later if the system integrates many sensors or edge devices publishing lightweight telemetry |
| Validation | class-validator, class-transformer | Validate DTO ở boundary |
| Config | @nestjs/config | Không hard-code env |
| Logging | Nest Logger hoặc logger chuẩn hóa | Không log secret/token |
| Testing | Jest | Unit test + integration test cho logic quan trọng |
=======
| Thành phần    | Công nghệ đề xuất                  | Ghi chú                                           |
| ------------- | ---------------------------------- | ------------------------------------------------- |
| Runtime       | Node.js LTS                        | Không dùng API experimental nếu không cần         |
| Framework     | NestJS                             | Modular monolith trước, microservice sau nếu cần  |
| Language      | TypeScript                         | Bắt buộc strict typing                            |
| Database      | PostgreSQL                         | UUID primary key, timestamptz                     |
| ORM           | TypeORM                            | Entity + migration rõ ràng                        |
| Auth          | JWT                                | Access token + refresh token nếu scope yêu cầu    |
| Authorization | RBAC                               | roles, permissions, guards                        |
| Realtime      | WebSocket Gateway                  | Room status, meeting status, presence             |
| IoT messaging | MQTT                               | Capture agent, room device event                  |
| Validation    | class-validator, class-transformer | Validate DTO ở boundary                           |
| Config        | @nestjs/config                     | Không hard-code env                               |
| Logging       | Nest Logger hoặc logger chuẩn hóa  | Không log secret/token                            |
| Testing       | Jest                               | Unit test + integration test cho logic quan trọng |
>>>>>>> e5d5f3a2b55545e25954451e995d85a7f165a802

### 3.2. Kiến trúc tổng thể

Backend đi theo hướng **modular monolith**:

- Mỗi domain có module riêng trong `/src/modules/<module-name>`.
- Không chia microservice sớm khi chưa cần.
- Các module giao tiếp qua service/export rõ ràng, không import chéo bừa bãi.
- Database dùng chung PostgreSQL nhưng boundary logic vẫn theo module.
- Device event ingestion, camera callbacks and WebSocket are packaged in clear modules/adapters.
- MQTT is reserved for future extension only and is not part of the v1 core flow.

---

## 4. Kiến trúc module backend

### 4.1. Module chính nên có

<<<<<<< HEAD
| Module | Vai trò | Đường dẫn backend |
|---|---|---|
| `auth` | Login, logout, refresh token, password reset, session, guard | `/src/modules/auth` |
| `accounts` | User profile, departments, roles, permissions, account status | `/src/modules/accounts` |
| `meetings` | Meeting core: tạo/sửa/hủy/xem cuộc họp, participants, agenda, notes | `/src/modules/meetings` |
| `approvals` | Meeting request approval, emergency/ad-hoc approval nếu có | `/src/modules/approvals` |
| `scheduling` | Conflict checking, schedule suggestions, recurrence handling | `/src/modules/scheduling` |
| `rooms` | Room, seat, booking, room status, capacity, location | `/src/modules/rooms` |
| `equipment` | Equipment, assignment, room device, camera/mic/device mapping | `/src/modules/equipment` |
| `iot` | Device event ingestion, raw IoT device events, device heartbeat, device health | `/src/modules/iot` |
| `device-user-mappings` | Map system user với Face Server person/device identity | `/src/modules/device-user-mappings` |
| `face-attendance` | Face Server HTTP callbacks, normalize face verify/stranger/heartbeat events | `/src/modules/face-attendance` |
| `attendance` | Attendance records, check-in/check-out, participant attendance | `/src/modules/attendance` |
| `presence` | Presence snapshot, presence events, face/camera signal mapping | `/src/modules/presence` |
| `utilization` | Room usage, no-show, early vacancy, auto-release room | `/src/modules/utilization` |
| `live-meeting` | Start/pause/resume/extend/end active meeting session | `/src/modules/live-meeting` |
| `recording` | Recording config/session/segment, media files | `/src/modules/recording` |
| `transcription` | Transcript management, transcript text/segments nếu có | `/src/modules/transcription` |
| `minutes` | Meeting minutes, decisions, action items | `/src/modules/minutes` |
| `documents` | Document metadata/setup-only knowledge area | `/src/modules/documents` |
| `notifications` | Notification, recipients, email/push/in-app events | `/src/modules/notifications` |
| `reports` | Report exports, generated reports | `/src/modules/reports` |
| `analytics` | Dashboard, KPI, room utilization analytics | `/src/modules/analytics` |
| `administration` | System config, policies, audit logs, admin operations | `/src/modules/administration` |
| `common` | Shared decorators, guards, pipes, filters, utils | `/src/common` |
| `database` | Database module, migration config, seed scripts | `/src/database` |
=======
| Module           | Vai trò                                                             | Đường dẫn backend             |
| ---------------- | ------------------------------------------------------------------- | ----------------------------- |
| `auth`           | Login, logout, refresh token, password reset, session, guard        | `/src/modules/auth`           |
| `accounts`       | User profile, departments, roles, permissions, account status       | `/src/modules/accounts`       |
| `meetings`       | Meeting core: tạo/sửa/hủy/xem cuộc họp, participants, agenda, notes | `/src/modules/meetings`       |
| `approvals`      | Meeting request approval, emergency/ad-hoc approval nếu có          | `/src/modules/approvals`      |
| `scheduling`     | Conflict checking, schedule suggestions, recurrence handling        | `/src/modules/scheduling`     |
| `rooms`          | Room, seat, booking, room status, capacity, location                | `/src/modules/rooms`          |
| `equipment`      | Equipment, assignment, room device, camera/mic/device mapping       | `/src/modules/equipment`      |
| `iot`            | MQTT events, IoT device event ingestion, device heartbeat           | `/src/modules/iot`            |
| `attendance`     | Attendance records, check-in/check-out, participant attendance      | `/src/modules/attendance`     |
| `presence`       | Presence snapshot, presence events, face/camera signal mapping      | `/src/modules/presence`       |
| `utilization`    | Room usage, no-show, early vacancy, auto-release room               | `/src/modules/utilization`    |
| `live-meeting`   | Start/pause/resume/extend/end active meeting session                | `/src/modules/live-meeting`   |
| `recording`      | Recording config/session/segment, media files                       | `/src/modules/recording`      |
| `transcription`  | Transcript management, transcript text/segments nếu có              | `/src/modules/transcription`  |
| `minutes`        | Meeting minutes, decisions, action items                            | `/src/modules/minutes`        |
| `documents`      | Document metadata/setup-only knowledge area                         | `/src/modules/documents`      |
| `notifications`  | Notification, recipients, email/push/in-app events                  | `/src/modules/notifications`  |
| `reports`        | Report exports, generated reports                                   | `/src/modules/reports`        |
| `analytics`      | Dashboard, KPI, room utilization analytics                          | `/src/modules/analytics`      |
| `administration` | System config, policies, audit logs, admin operations               | `/src/modules/administration` |
| `common`         | Shared decorators, guards, pipes, filters, utils                    | `/src/common`                 |
| `database`       | Database module, migration config, seed scripts                     | `/src/database`               |
>>>>>>> e5d5f3a2b55545e25954451e995d85a7f165a802

### 4.2. Module cần chú ý về scope

#### `documents`

`documents` hiện tại là khu vực **setup-only / provisional** cho AI Document hoặc knowledge management tương lai.

Không được tự ý triển khai:

- Vector database.
- Embedding pipeline.
- Chunking pipeline.
- Semantic search thật.
- RAG pipeline.
- Open-source AI model integration.
- Third-party AI provider integration.

Chỉ được làm khi có yêu cầu rõ ràng từ team.

Hiện tại `documents` nên chỉ quản lý:

- Metadata tài liệu.
- Liên kết document với meeting/minutes/recording nếu schema có.
- Trạng thái xử lý document nếu cần.
- Cấu hình/provisional flags trong `system_configs` hoặc `system_policies`.

#### `transcription`

`transcription` được phép quản lý dữ liệu transcript nếu use case yêu cầu. Tuy nhiên, không mặc định rằng backend tự chạy AI transcription. Nếu có tích hợp transcription, hãy thiết kế qua interface/adapter:

- `TranscriptionProviderPort`
- `MockTranscriptionProvider`
- `ExternalTranscriptionProvider` sau này nếu team chọn provider

Không hard-code provider AI.

#### `iot`, `presence`, `equipment`

Các module này có ranh giới gần nhau nhưng không được trộn lẫn:

- `equipment`: quản lý thiết bị như tài sản/cấu hình.
- `iot`: nhận và lưu event từ device/capture agent.
- `presence`: diễn giải tín hiệu thành trạng thái hiện diện.

---

## 5. Database baseline

### 5.1. Database chính

Database hiện tại là **Database v3.2 Compact**.

Thiết kế hiện tại có **39 bảng** (đã lược bỏ session DB, tinh gọn audit và một số bảng trung gian so với các bản trước).

Database dùng:

- PostgreSQL.
- UUID primary key.
- `gen_random_uuid()` cho id mặc định nếu dùng PostgreSQL extension phù hợp.
- `timestamptz` cho thời gian có timezone.
- Soft delete chỉ dùng khi thật sự cần và đã được thống nhất.
- Foreign key rõ ràng.
- Index cho FK, lookup field, status field, time range field quan trọng.

### 5.2. Nhóm bảng chính

#### Identity & Access

- `departments`
- `users`
- `roles`
- `permissions`
- `user_roles`
- `role_permissions`
- `password_reset_requests`
- `face_profiles`

#### Meeting Core & Scheduling

- `meetings`
- `meeting_requests`
- `meeting_participants`
- `meeting_external_participants`
- `meeting_agendas`
- `meeting_recurrence_rules`
- `meeting_notes`
- `meeting_events`
- `schedule_conflicts`

#### Room & Utilization

- `rooms`
- `room_seats`
- `room_bookings`
- `room_booking_usages`
- `no_show_cases`
- `room_events`

#### Equipment / IoT / Capture Agent

- `equipments`
- `equipment_assignments`
- `iot_devices`
- `iot_device_events`
- `capture_sessions`
- `capture_session_channels`

#### Attendance & Presence

- `attendance_records`
- `attendance_events`
- `presence_snapshots`

#### Recording / Media / Transcription

- `recording_configs`
- `recording_sessions`
- `recording_segments`
- `media_files`
- `transcripts`

#### Minutes / Knowledge / AI Document setup

- `meeting_minutes`
- `meeting_action_items`
- `documents`

#### Notification / Reporting / Administration

- `notifications`
- `notification_recipients`
- `report_exports`
- `background_jobs`
- `system_configs`
- `system_policies`
- `audit_logs`

### 5.3. Nguyên tắc database tuyệt đối

Không tự ý:

- Thêm bảng mới khi chưa có yêu cầu rõ ràng.
- Xóa bảng hiện có trong baseline.
- Đổi tên bảng/cột nếu chưa có migration và lý do rõ ràng.
- Dùng integer auto-increment id cho bảng domain chính nếu baseline dùng UUID.
- Dùng `timestamp` thay cho `timestamptz` cho dữ liệu thời gian quan trọng.
- Lưu password plain text.
- Lưu token raw nếu có thể hash.
- Lưu file binary trực tiếp vào PostgreSQL nếu không có lý do mạnh.

Khi cần thay đổi schema:

1. Kiểm tra spec/use case/API contract/database baseline.
2. Tạo migration rõ ràng.
3. Cập nhật entity.
4. Cập nhật DTO/API response nếu bị ảnh hưởng.
5. Cập nhật seed/test nếu cần.
6. Ghi chú breaking change nếu có.

---

## 6. Cấu trúc thư mục backend đề xuất

```text
/src
  /common
    /constants
    /decorators
    /exceptions
    /filters
    /guards
    /interceptors
    /pipes
    /types
    /utils

  /config
    app.config.ts
    database.config.ts
    jwt.config.ts
    device-callback.config.ts
    camera.config.ts
    mqtt.config.ts // future only, not used in v1
    storage.config.ts

  /database
    data-source.ts
    database.module.ts
    /migrations
    /seeds

  /modules
    /auth
      auth.module.ts
      auth.controller.ts
      auth.service.ts
      /dto
      /entities
      /guards
      /strategies

    /accounts
      accounts.module.ts
      accounts.controller.ts
      accounts.service.ts
      /dto
      /entities
      /repositories

    /meetings
      meetings.module.ts
      meetings.controller.ts
      meetings.service.ts
      /dto
      /entities
      /repositories

    /approvals
    /scheduling
    /rooms
    /equipment
    /iot
    /attendance
    /presence
    /utilization
    /live-meeting
    /recording
    /transcription
    /minutes
    /documents
    /notifications
    /reports
    /analytics
    /administration

  app.module.ts
  main.ts
```

### 6.1. Cấu trúc trong một module chuẩn

```text
/src/modules/<module-name>
  <module-name>.module.ts
  <module-name>.controller.ts
  <module-name>.service.ts

  /dto
    create-xxx.dto.ts
    update-xxx.dto.ts
    query-xxx.dto.ts
    xxx-response.dto.ts

  /entities
    xxx.entity.ts

  /repositories
    xxx.repository.ts

  /types
    xxx-status.type.ts
    xxx-filter.type.ts

  /constants
    xxx.constants.ts

  /tests
    xxx.service.spec.ts
    xxx.controller.spec.ts
```

Không bắt buộc module nào cũng có đủ tất cả folder. Chỉ tạo khi cần.

---

## 7. Convention đặt tên

### 7.1. File/folder

- Folder: kebab-case. Ví dụ: `live-meeting`, `meeting-participants`.
- File: kebab-case. Ví dụ: `create-meeting.dto.ts`.
- Class: PascalCase. Ví dụ: `CreateMeetingDto`.
- Variable/function: camelCase.
- Entity class: PascalCase + `Entity`. Ví dụ: `MeetingEntity`.
- DTO class: PascalCase + `Dto`. Ví dụ: `UpdateRoomDto`.

### 7.2. Database

- Table name: snake_case, plural. Ví dụ: `meeting_participants`.
- Column name: snake_case. Ví dụ: `created_at`, `updated_by`.
- FK column: `<entity>_id`. Ví dụ: `meeting_id`, `room_id`, `user_id`.
- Status column: `status` hoặc `<domain>_status` nếu cần rõ nghĩa.
- Enum value trong DB: lowercase snake_case nếu lưu dạng string. Ví dụ: `pending_approval`.

### 7.3. API route

- Prefix chung: `/api/v1`.
- Resource route dùng plural noun.
- Không dùng động từ nếu không cần.
- Action endpoint chỉ dùng khi đó là nghiệp vụ rõ ràng.

Ví dụ:

```text
GET    /api/v1/meetings
POST   /api/v1/meetings
GET    /api/v1/meetings/:id
PATCH  /api/v1/meetings/:id
DELETE /api/v1/meetings/:id

POST   /api/v1/meetings/:id/cancel
POST   /api/v1/meeting-requests/:id/approve
POST   /api/v1/meeting-requests/:id/reject
POST   /api/v1/rooms/:id/release
POST   /api/v1/live-meetings/:id/start
POST   /api/v1/live-meetings/:id/end
```

---

## 8. API response convention

### 8.1. Success response

Dùng format thống nhất:

```json
{
  "success": true,
  "message": "Meeting created successfully",
  "data": {},
  "meta": {}
}
```

Với list có pagination:

```json
{
  "success": true,
  "message": "Meetings retrieved successfully",
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 125,
    "totalPages": 7
  }
}
```

### 8.2. Error response

Dùng exception filter chung để chuẩn hóa:

```json
{
  "success": false,
  "message": "Room is not available in selected time range",
  "error": {
    "code": "ROOM_NOT_AVAILABLE",
    "details": {}
  },
  "timestamp": "2026-05-26T10:00:00.000Z",
  "path": "/api/v1/meetings"
}
```

### 8.3. HTTP status code

| Trường hợp                       | Status |
| -------------------------------- | -----: |
| Tạo thành công                   |  `201` |
| Lấy/cập nhật/xóa mềm thành công  |  `200` |
| Không có body trả về             |  `204` |
| Input sai                        |  `400` |
| Chưa đăng nhập                   |  `401` |
| Không đủ quyền                   |  `403` |
| Không tìm thấy                   |  `404` |
| Conflict nghiệp vụ               |  `409` |
| Validation semantic không hợp lệ |  `422` |
| Rate limited                     |  `429` |
| Lỗi server                       |  `500` |

### 8.4. Pagination query chuẩn

```text
?page=1&limit=20&sortBy=created_at&sortOrder=desc
```

Giới hạn:

- Default `page = 1`.
- Default `limit = 20`.
- Max `limit = 100` trừ API export/report.
- Validate `sortBy` theo allowlist, không truyền trực tiếp vào SQL.

---

## 9. Authentication & Authorization

### 9.1. Authentication

Backend cần hỗ trợ tối thiểu:

- Login bằng email/username + password.
- Hash password bằng bcrypt/argon2.
- JWT access token.
- Sử dụng cơ chế Stateless JWT Blacklist qua Redis Cache thay cho bảng `user_sessions`.
- Logout/revoke session thông qua JWT Blacklist.
- Password reset qua `password_reset_requests` nếu use case yêu cầu.

Không được:

- Lưu password plain text.
- Log password/token.
- Trả password hash ra API response.
- Tin tưởng `userId` từ body nếu endpoint cần lấy user hiện tại từ token.

### 9.2. Authorization

Dùng RBAC dựa trên:

- `roles`
- `permissions`
- `user_roles`
- `role_permissions`

Nên có:

- `JwtAuthGuard`
- `RolesGuard` hoặc `PermissionsGuard`
- Decorator `@CurrentUser()`
- Decorator `@RequirePermissions()`

Ví dụ permission naming:

```text
meeting:create
meeting:read
meeting:update
meeting:cancel
meeting:approve
room:create
room:update
room:read
recording:start
recording:read
admin:manage_config
```

Không hard-code quyền theo role name nếu có thể kiểm tra permission.

---

## 10. Business rule quan trọng

### 10.1. Meeting creation

Khi tạo meeting, cần kiểm tra:

- Người tạo có quyền tạo meeting.
- Thời gian bắt đầu < thời gian kết thúc.
- Thời gian không nằm trong quá khứ, trừ khi use case cho phép admin tạo record lịch sử.
- Participants hợp lệ.
- Room tồn tại và active nếu có room.
- Room đủ capacity nếu check capacity được yêu cầu.
- Không conflict room booking.
- Không conflict lịch người tham gia quan trọng nếu use case yêu cầu.
- Nếu policy yêu cầu approval, tạo `meeting_requests` thay vì auto-confirm meeting.

### 10.2. Room booking

Không cho double booking cùng room trong time range overlap.

Overlap logic chuẩn:

```text
existing.start_at < new.end_at AND existing.end_at > new.start_at
```

Cần loại trừ booking đã cancelled/released/rejected tùy status.

### 10.3. Approval

Approval flow phải rõ:

- Pending request không được xem là meeting confirmed nếu policy yêu cầu duyệt.
- Approve phải ghi nhận `approved_by`, `approved_at`, status/event nếu schema có.
- Reject phải có reason nếu use case yêu cầu.
- Người approve không nên là người tự approve nếu policy cấm.

### 10.4. Attendance / Presence

Phân biệt:

- `attendance_records`: kết quả điểm danh theo meeting/user.
- `attendance_events`: log sự kiện check-in/check-out.
- `presence_snapshots`: ảnh chụp/trạng thái presence tại một thời điểm/phòng.

Không dùng presence snapshot thay thế hoàn toàn attendance record.

### 10.5. No-show / Utilization

No-show nên dựa trên rule rõ ràng, ví dụ:

- Đến sau X phút từ giờ bắt đầu mà không có check-in/presence.
- Room không có tín hiệu sử dụng.
- Meeting không được start.

Auto-release phòng phải:

- Kiểm tra policy trong `system_configs` hoặc `system_policies`.
- Ghi `room_events` hoặc `meeting_events`.
- Ghi audit log nếu là hành động tự động quan trọng.
- Gửi notification nếu cần.

### 10.6. Live meeting

Trạng thái live meeting có thể gồm:

```text
not_started
in_progress
paused
ended
cancelled
extended
```

Không cho:

- Start meeting đã ended/cancelled.
- End meeting chưa start nếu policy không cho phép.
- Extend vượt quá room availability nếu room có booking sau đó.

### 10.7. Recording

Recording cần tách:

- `recording_configs`: cấu hình ghi âm/ghi hình.
- `recording_sessions`: phiên ghi.
- `recording_segments`: các đoạn ghi.
- `media_files`: metadata file.

Không lưu file lớn trực tiếp vào DB nếu không có yêu cầu. Nên lưu metadata + storage URL/path.

### 10.8. Transcripts / Minutes / Action items

- Transcript là dữ liệu nội dung chuyển lời nói thành văn bản.
- Minutes là biên bản chính thức hoặc bán chính thức.
- Action item là việc cần làm sau meeting.

Không gộp ba loại dữ liệu này vào một bảng/service nếu schema đã tách.

---

## 11. Device, IoT, camera, microphone và capture agent

### 11.1. Khái niệm

- `equipments`: tài sản/thiết bị vật lý hoặc thiết bị phòng họp.
- `iot_devices`: thiết bị có khả năng gửi event/heartbeat/data.
- `iot_device_events`: log event từ thiết bị.
- `capture_sessions`: phiên thu âm/ghi hình/capture trong một meeting/room.
- `capture_session_channels`: từng kênh capture, ví dụ microphone/camera/screen.
- `device_user_mappings`: mapping giữa người dùng trong hệ thống và định danh người đó trên thiết bị/camera/face server.

### 11.2. Hai loại camera trong dự án

#### Door Face Attendance Terminal

Thiết bị đặt tại cửa phòng họp, dùng để check-in/check-out bằng khuôn mặt. Đây **không phải IP camera thường** mà là Face Server có sẵn camera, màn hình, face database nội bộ, face enrollment, face verification, HTTP Subscription và web admin.

Thiết bị tự thực hiện face enrollment, face template storage, face verification, similarity calculation và control log. Backend **không** tự detect face, không tự extract embedding, không tự so khớp khuôn mặt. Backend chỉ nhận kết quả nhận diện từ thiết bị.

Luồng tích hợp v1:

```text
Door Face Attendance Terminal
→ HTTP Subscription
→ NestJS backend callback endpoint
→ iot_device_events (raw)
→ device_user_mappings
→ attendance_events / attendance_records
→ WebSocket dashboard
```

#### IP Room Camera

Camera đặt tại góc phòng họp, dùng để theo dõi phòng có người hay không, cập nhật occupancy/presence, phát hiện phòng trống sớm, phát hiện no-show, và ghi hình nếu được bật.

IP Room Camera **không phải nguồn định danh người chính**. Định danh người nên đến từ Door Face Attendance Terminal.

IP Room Camera cung cấp RTSP stream, xử lý bởi Python Camera Service, không xử lý trực tiếp trong NestJS request handler.

Luồng tích hợp v1:

```text
IP Room Camera
→ RTSP
→ Python Camera Service / OpenCV / FFmpeg
→ REST API to NestJS
→ presence_snapshots / room_events / room_booking_usages / no_show_cases
→ WebSocket dashboard
```

### 11.3. Nguyên tắc tích hợp thiết bị

Backend không phụ thuộc trực tiếp vào SDK cụ thể của camera/vendor. Thiết kế qua adapter/port:

```text
DeviceProviderPort
FaceDeviceProviderPort
CaptureAgentPort
```

Mục tiêu là thay vendor mà không phá domain logic.

### 11.4. Device callback endpoints

Các endpoint callback từ device phải tách khỏi API người dùng thông thường:

```text
POST /api/v1/device-callbacks/face/heartbeat
POST /api/v1/device-callbacks/face/verify
POST /api/v1/device-callbacks/face/stranger
```

Các endpoint này là system-to-system, **không** dùng JWT user login. Thay vào đó validate:

- Source IP nếu có thể.
- Device code hoặc device id.
- Callback token/shared secret nếu thiết bị hỗ trợ.
- Device còn active và đã được assign vào room.

Device có thể gửi payload dạng vendor-specific (JSON, form data, text, XML, multipart). Callback controller được phép nhận raw body nhưng phải theo quy trình:

```text
raw body nhận tại boundary
→ store raw payload vào iot_device_events
→ normalize payload
→ validate device và mapping
→ xử lý business logic (attendance / presence)
```

Không truyền raw payload trực tiếp vào business service để quyết định attendance.

### 11.5. Room camera endpoints (từ Python Camera Service)

```text
POST /api/v1/room-camera/presence
POST /api/v1/room-camera/occupancy-snapshots
POST /api/v1/room-camera/events
```

### 11.6. Door face event processing flow

```text
1. Face Server gửi verify event về backend.
2. Backend xác định source device.
3. Backend lưu raw event vào iot_device_events.
4. Backend normalize payload thành internal DTO.
5. Backend resolve device person qua device_user_mappings.
6. Backend resolve room từ iot_devices.room_id.
7. Backend tìm active meeting trong room tại thời điểm event.
8. Nếu user thuộc meeting participants:
   - Tạo attendance_events.
   - Tạo/cập nhật attendance_records.
   - Cập nhật meeting_participants.attendance_status nếu cần.
9. Nếu user unknown hoặc không phải participant:
   - Lưu event.
   - Đánh dấu pending_review hoặc unknown_face.
   - Tạo notification nếu cần.
10. Backend emit WebSocket event về frontend.
```

### 11.7. Room camera event processing flow

```text
1. Python Camera Service phát hiện occupancy event.
2. Python gửi event về NestJS REST API.
3. Backend validate device.
4. Backend lưu raw event vào iot_device_events.
5. Backend tạo presence_snapshots.
6. Backend tạo room_events nếu room status thay đổi.
7. Backend cập nhật room_booking_usages nếu có booking/meeting liên quan.
8. Utilization service đánh giá no-show hoặc early-empty rules.
9. Backend emit WebSocket event về frontend.
```

### 11.8. Module boundary cho camera

| Module | Trách nhiệm camera | Không trách nhiệm |
|---|---|---|
| `equipment` | Equipment asset CRUD, assign thiết bị vào phòng | Processing camera event, tạo attendance |
| `iot` | `iot_devices` CRUD, lưu raw `iot_device_events`, heartbeat | Business attendance decision, no-show, release phòng |
| `device-user-mappings` | Map system user với Face Server person, track sync_status | Face recognition, attendance logic |
| `face-attendance` | Face Server HTTP callbacks, normalize face event payload, gọi AttendanceService | Quản lý booking, no-show, train model |
| `presence` | Room camera event ingestion, `presence_snapshots`, read API | Device CRUD, attendance final decision, room release |
| `attendance` | `attendance_events`, `attendance_records`, check-in/check-out sau khi event đã normalize | Raw device event parsing, RTSP processing |
| `utilization` | `room_booking_usages`, no-show evaluation, `no_show_cases`, auto-release | Đọc camera stream, parse device payload |
| `recording` | Recording configs/sessions/segments, media file metadata | FFmpeg process trực tiếp trong request, face attendance |

### 11.9. Quy tắc bảo mật cho device callbacks

Minimum validation:

```text
1. Resolve device qua: source IP, device code, hoặc callback token/shared secret.
2. Check device tồn tại trong iot_devices.
3. Check device.status là online/active/enabled.
4. Check device.room_id tồn tại nếu event cần room.
5. Lưu raw payload trước khi xử lý.
6. Không tin timestamp thiết bị nếu lệch quá xa server time.
7. Không để device payload tự trigger critical action như auto-release mà không qua utilization service.
```

Khuyến nghị thêm:

```text
- IP allowlist cho lab/demo nếu device trong LAN.
- Callback token nếu device hỗ trợ.
- Log tất cả callback request vào iot_device_events.
- Không log password/secret từ device config.
```

### 11.10. MQTT policy cho v1

MQTT/Mosquitto **không được dùng trong v1**.

Không implement: Mosquitto broker, MQTT subscriber/publisher service, MQTT topic contract, MQTT env requirement.

Cho phép: giữ `iot_devices.mqtt_topic` nếu database baseline đã có, giữ enum value `mqtt` trong source_protocol nếu đã có trong DB, đề cập MQTT là future extension.

MQTT có thể được xem xét ở future version nếu hệ thống mở rộng thêm nhiều sensor hoặc edge device publish telemetry event nhẹ.

### 11.11. IVSS policy cho v1

IVSS **không phải thành phần core MVP backend**.

Không implement: IVSS SDK integration, IVSS-dependent recording flow, IVSS-dependent camera discovery, IVSS là mandatory camera hub.

Cho phép: đề cập IVSS là optional production camera management/recording server, store IVSS như một `iot_device` hoặc `equipment` nếu team muốn track.

IVSS có thể được xem xét sau cho: centralized camera management, centralized recording, playback, camera operation monitoring.

### 11.12. Điều agent không được làm với camera

- Thêm MQTT/Mosquitto trong v1.
- Implement backend-side face recognition model.
- Implement face embedding extraction hoặc model training.
- Phụ thuộc IVSS cho core flow.
- Đọc RTSP stream trực tiếp trong NestJS HTTP request lifecycle.
- Lưu binary video/audio/image lớn trực tiếp vào PostgreSQL.
- Để raw device payload tự quyết định critical business state.
- Bỏ qua bước lưu raw event hoặc bỏ qua device validation.
- Hard-code camera IP/password trong source code.
- Commit credential thật.
- Log camera password, token hoặc raw secret.

---

## 12. WebSocket realtime

Dùng WebSocket cho các thay đổi realtime như:

- Room status changed.
- Meeting status changed.
- Presence updated.
- Recording status changed.
- Notification pushed.

Không dùng WebSocket thay thế REST API cho CRUD thông thường.

Event naming nên rõ:

```text
room.status.updated
meeting.status.updated
presence.snapshot.created
recording.status.updated
notification.created
```

Payload nên nhỏ, không gửi object quá lớn nếu client có thể gọi REST để lấy detail.

---

## 13. DTO, Validation và Input Handling

### 13.1. DTO bắt buộc ở boundary

Controller không nhận raw body không kiểm soát.

Đúng:

```ts
@Post()
create(@Body() dto: CreateMeetingDto) {
  return this.meetingsService.create(dto);
}
```

Không nên:

```ts
@Post()
create(@Body() body: any) {
  return this.meetingsService.create(body);
}
```

**Exception: device callback endpoints may receive raw body** because Face Server or third-party devices can send vendor-specific payloads (JSON, form-data, XML, multipart, etc.). Raw body is allowed only at the device callback boundary (`/api/v1/device-callbacks/face/*`) and must be stored into `iot_device_events` before any normalization or business logic is executed.

### 13.2. ValidationPipe global

Trong `main.ts` nên có:

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);
```

### 13.3. Không tin input từ client

Luôn validate:

- UUID.
- Email.
- Date/time.
- Enum/status.
- Pagination.
- Sort field.
- File metadata.
- Device event payload.

---

## 14. TypeORM convention

### 14.1. Entity

Entity nên dùng:

```ts
@PrimaryGeneratedColumn('uuid')
id!: string;

@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
createdAt!: Date;

@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
updatedAt!: Date;
```

Nếu cần audit:

```ts
@Column({ name: 'created_by', type: 'uuid', nullable: true })
createdBy?: string;

@Column({ name: 'updated_by', type: 'uuid', nullable: true })
updatedBy?: string;
```

### 14.2. Không dùng synchronize trong production

Trong production:

```ts
synchronize: false;
```

Dùng migration thay vì auto sync.

### 14.3. Query

- Dùng repository/query builder an toàn.
- Không nối chuỗi SQL với input người dùng.
- Nếu dùng raw SQL, dùng parameter binding.

Đúng:

```ts
.where('meeting.room_id = :roomId', { roomId })
```

Sai:

```ts
.where(`meeting.room_id = '${roomId}'`)
```

### 14.4. Transaction

Dùng transaction khi một use case thay đổi nhiều bảng.

Ví dụ cần transaction:

- Create meeting + participants + room booking + event log.
- Approve request + create confirmed meeting + notification.
- End meeting + close recording + update room usage.
- Auto-release room + no-show case + event + notification.

---

## 15. Service layer convention

Controller chỉ làm:

- Nhận request.
- Validate qua DTO/pipe.
- Lấy current user nếu cần.
- Gọi service.
- Trả response.

Service làm:

- Business rule.
- Transaction.
- Gọi repository/module khác.
- Throw domain exception.

Repository làm:

- Query database.
- Không chứa business rule phức tạp.

Không để controller chứa logic nghiệp vụ dài.

---

## 16. Exception convention

Nên định nghĩa domain error code rõ ràng:

```text
MEETING_NOT_FOUND
MEETING_ALREADY_CANCELLED
ROOM_NOT_FOUND
ROOM_NOT_AVAILABLE
ROOM_CAPACITY_EXCEEDED
SCHEDULE_CONFLICT
APPROVAL_REQUIRED
PERMISSION_DENIED
INVALID_MEETING_STATE
DEVICE_NOT_FOUND
DEVICE_INACTIVE
RECORDING_NOT_ENABLED
```

Dùng exception phù hợp:

- `BadRequestException`
- `UnauthorizedException`
- `ForbiddenException`
- `NotFoundException`
- `ConflictException`
- `UnprocessableEntityException`

Không throw `Error()` chung chung ở business logic.

---

## 17. Audit logging

Các hành động quan trọng nên ghi audit:

- Login failed nhiều lần nếu có policy.
- Create/update/delete user.
- Role/permission change.
- Meeting approval/rejection.
- Meeting cancellation.
- Room auto-release.
- Recording start/stop.
- System config/policy change.
- Manual override room/meeting status.

Audit log nên có tối thiểu:

- Actor user id.
- Action.
- Target type.
- Target id.
- Before/after nếu phù hợp.
- IP/user agent nếu có.
- Timestamp.

Không ghi secret/token/password vào audit log.

---

## 18. Notification convention

Notification không nên gửi trực tiếp rải rác trong nhiều service.

Nên có `NotificationsService` hoặc event-based approach:

```text
MeetingCreatedEvent
MeetingApprovedEvent
MeetingCancelledEvent
RoomAutoReleasedEvent
RecordingReadyEvent
ActionItemAssignedEvent
```

Service domain phát event hoặc gọi notification service qua boundary rõ ràng.

`notifications` lưu nội dung/thông tin notification.  
`notification_recipients` lưu người nhận và trạng thái đọc/gửi.

---

## 19. Background jobs

Dùng `background_jobs` để tracking các tác vụ async nếu có:

- Generate report export.
- Process recording metadata.
- Import/sync device users.
- Send batch notifications.
- Cleanup expired sessions/reset tokens.
- Evaluate no-show/auto-release theo lịch.

Job nên có:

- type.
- status.
- payload/reference.
- attempts.
- error message rút gọn.
- created_at/started_at/completed_at.

Không chạy tác vụ nặng trực tiếp trong request nếu có thể đưa vào job.

---

## 20. Security baseline

### 20.1. Bắt buộc

- Password phải hash.
- JWT secret lấy từ env.
- Không hard-code credential.
- Validate input bằng DTO.
- Dùng RBAC/permission guard cho endpoint nhạy cảm.
- Không expose stack trace ở production.
- Không log token/password/secret.
- Không trả toàn bộ user object nếu chứa field nhạy cảm.
- CORS cấu hình theo env.
- Rate limit endpoint auth nếu có thể.

### 20.2. Dữ liệu nhạy cảm

Cẩn thận với:

- Face profile.
- Device person id/code.
- Recording/media/transcript.
- Meeting content/minutes.
- Audit log.

Các API đọc dữ liệu này phải kiểm tra quyền kỹ hơn CRUD thông thường.

---

## 21. Environment variables đề xuất

```env
NODE_ENV=development
PORT=3000
API_PREFIX=/api/v1

DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=postgres
DATABASE_NAME=smart_meeting
DATABASE_SSL=false

JWT_ACCESS_SECRET=change_me
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=change_me
JWT_REFRESH_EXPIRES_IN=7d

BCRYPT_SALT_ROUNDS=10

DEVICE_CALLBACK_BASE_URL=http://localhost:3000
FACE_DEVICE_CALLBACK_TOKEN=
DEVICE_CALLBACK_IP_ALLOWLIST=

# Future only - not used in v1
MQTT_ENABLED=false
MQTT_URL=
MQTT_USERNAME=
MQTT_PASSWORD=

STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=./storage

CORS_ORIGIN=http://localhost:5173
```

Không commit file `.env` thật.

---

## 22. API endpoint grouping gợi ý

### 22.1. Auth

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/refresh
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password
GET    /api/v1/auth/me
```

### 22.2. Accounts

```text
GET    /api/v1/users
POST   /api/v1/users
GET    /api/v1/users/:id
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id

GET    /api/v1/departments
POST   /api/v1/departments
PATCH  /api/v1/departments/:id

GET    /api/v1/roles
POST   /api/v1/roles
PATCH  /api/v1/roles/:id
POST   /api/v1/roles/:id/permissions
```

### 22.3. Meetings

```text
GET    /api/v1/meetings
POST   /api/v1/meetings
GET    /api/v1/meetings/:id
PATCH  /api/v1/meetings/:id
POST   /api/v1/meetings/:id/cancel

GET    /api/v1/meetings/:id/participants
POST   /api/v1/meetings/:id/participants
DELETE /api/v1/meetings/:id/participants/:participantId

GET    /api/v1/meetings/:id/agendas
POST   /api/v1/meetings/:id/agendas
PATCH  /api/v1/meetings/:id/agendas/:agendaId
```

### 22.4. Approvals

```text
GET    /api/v1/meeting-requests
POST   /api/v1/meeting-requests
GET    /api/v1/meeting-requests/:id
POST   /api/v1/meeting-requests/:id/approve
POST   /api/v1/meeting-requests/:id/reject
POST   /api/v1/meeting-requests/:id/cancel
```

### 22.5. Scheduling

```text
POST   /api/v1/scheduling/check-conflicts
POST   /api/v1/scheduling/suggest-times
POST   /api/v1/scheduling/suggest-rooms
GET    /api/v1/schedule-conflicts
```

### 22.6. Rooms

```text
GET    /api/v1/rooms
POST   /api/v1/rooms
GET    /api/v1/rooms/:id
PATCH  /api/v1/rooms/:id
DELETE /api/v1/rooms/:id

GET    /api/v1/rooms/:id/bookings
POST   /api/v1/rooms/:id/bookings
POST   /api/v1/room-bookings/:id/cancel
POST   /api/v1/room-bookings/:id/release

GET    /api/v1/rooms/:id/status
GET    /api/v1/rooms/:id/events
```

### 22.7. Equipment / IoT

```text
GET    /api/v1/equipments
POST   /api/v1/equipments
GET    /api/v1/equipments/:id
PATCH  /api/v1/equipments/:id
DELETE /api/v1/equipments/:id

POST   /api/v1/equipment-assignments
DELETE /api/v1/equipment-assignments/:id

GET    /api/v1/iot-devices
POST   /api/v1/iot-devices
PATCH  /api/v1/iot-devices/:id
GET    /api/v1/iot-devices/:id/events
POST   /api/v1/iot/events

GET    /api/v1/device-user-mappings
POST   /api/v1/device-user-mappings
PATCH  /api/v1/device-user-mappings/:id
DELETE /api/v1/device-user-mappings/:id
```

### 22.7a. Face Attendance Terminal Callbacks (system-to-system, không dùng JWT user)

```text
POST   /api/v1/device-callbacks/face/heartbeat
POST   /api/v1/device-callbacks/face/verify
POST   /api/v1/device-callbacks/face/stranger
```

### 22.7b. Room Camera (từ Python Camera Service)

```text
POST   /api/v1/room-camera/presence
POST   /api/v1/room-camera/occupancy-snapshots
POST   /api/v1/room-camera/events
```

### 22.7c. Recording từ camera

```text
POST   /api/v1/recordings/video/start
POST   /api/v1/recordings/video/stop
GET    /api/v1/recordings
GET    /api/v1/recordings/:id
POST   /api/v1/recordings/:id/error
```

### 22.8. Attendance / Presence

```text
GET    /api/v1/meetings/:id/attendance
POST   /api/v1/meetings/:id/check-in
POST   /api/v1/meetings/:id/check-out

GET    /api/v1/presence/snapshots
POST   /api/v1/presence/snapshots
GET    /api/v1/rooms/:id/presence
```

### 22.9. Utilization

```text
GET    /api/v1/room-booking-usages
GET    /api/v1/no-show-cases
POST   /api/v1/no-show-cases/:id/resolve
POST   /api/v1/utilization/evaluate-no-show
POST   /api/v1/utilization/evaluate-early-vacancy
```

### 22.10. Live meeting

```text
POST   /api/v1/live-meetings/:meetingId/start
POST   /api/v1/live-meetings/:meetingId/pause
POST   /api/v1/live-meetings/:meetingId/resume
POST   /api/v1/live-meetings/:meetingId/extend
POST   /api/v1/live-meetings/:meetingId/end
GET    /api/v1/live-meetings/:meetingId/status
```

### 22.11. Recording / Transcription

```text
GET    /api/v1/recording-configs
PATCH  /api/v1/recording-configs/:id

POST   /api/v1/meetings/:id/recordings/start
POST   /api/v1/meetings/:id/recordings/stop
GET    /api/v1/meetings/:id/recordings
GET    /api/v1/recording-sessions/:id
GET    /api/v1/recording-sessions/:id/segments

GET    /api/v1/media-files/:id

GET    /api/v1/meetings/:id/transcripts
POST   /api/v1/meetings/:id/transcripts
PATCH  /api/v1/transcripts/:id
```

### 22.12. Minutes / Action items / Documents

```text
GET    /api/v1/meetings/:id/minutes
POST   /api/v1/meetings/:id/minutes
PATCH  /api/v1/meeting-minutes/:id

GET    /api/v1/meetings/:id/action-items
POST   /api/v1/meetings/:id/action-items
PATCH  /api/v1/action-items/:id

GET    /api/v1/documents
POST   /api/v1/documents
GET    /api/v1/documents/:id
PATCH  /api/v1/documents/:id
DELETE /api/v1/documents/:id
```

### 22.13. Notifications / Reports / Administration

```text
GET    /api/v1/notifications
PATCH  /api/v1/notifications/:id/read

POST   /api/v1/report-exports
GET    /api/v1/report-exports
GET    /api/v1/report-exports/:id

GET    /api/v1/analytics/room-utilization
GET    /api/v1/analytics/meeting-summary
GET    /api/v1/analytics/no-show-rate

GET    /api/v1/system-configs
PATCH  /api/v1/system-configs/:key
GET    /api/v1/system-policies
PATCH  /api/v1/system-policies/:id
GET    /api/v1/audit-logs
```

Endpoint trên là gợi ý contract backend. Khi có API Contract chính thức, phải ưu tiên API Contract.

---

## 23. Feature flags / provisional features

Các phần chưa chắc triển khai nên đặt sau feature flag/config:

- AI summary.
- AI document search.
- Embedding/vector search.
- Face recognition sync.
- Auto transcription provider.
- Auto no-show release.
- Recording auto-start.

Ví dụ config key:

```text
ai_document_enabled=false
transcription_provider=mock
auto_release_no_show_enabled=false
face_device_sync_enabled=false
recording_auto_start_enabled=false
```

Không bật mặc định tính năng có rủi ro cao khi chưa có policy.

---

## 24. Testing strategy

### 24.1. Unit test nên có

- Meeting time validation.
- Room booking overlap check.
- Approval state transition.
- No-show evaluation.
- Permission guard.
- Attendance check-in/check-out logic.
- Live meeting state transition.
- Recording state transition.

### 24.2. Integration test nên có

- Create meeting with room booking.
- Create meeting request then approve.
- Reject meeting request.
- Check room availability.
- Check-in participant.
- Start/end live meeting.
- Start/stop recording session.

### 24.3. Test convention

- Test business rule trong service.
- Mock external provider/device callbacks/camera service/storage.
- Mock MQTT only if a future MQTT feature is explicitly enabled.
- Không phụ thuộc vào real camera/mic/device trong test backend.
- Dùng test database hoặc transaction rollback cho integration test.

---

## 25. Seed data tối thiểu

Seed nên có:

- Default departments.
- Default roles: `admin`, `manager`, `employee`, `room_admin` nếu phù hợp.
- Default permissions.
- Default admin user cho dev.
- Một số room mẫu.
- Một số equipment/device mẫu nếu cần demo.
- Default system configs/policies.

Không seed dữ liệu nhạy cảm thật.

---

## 26. Coding rules cho agent

### 26.1. Trước khi code

Agent phải kiểm tra:

1. Use case/spec liên quan.
2. API contract liên quan.
3. Entity/database table liên quan.
4. Module boundary.
5. Permission/security requirement.
6. Transaction requirement.
7. Event/notification/audit requirement.

### 26.2. Khi viết code

Luôn ưu tiên:

- Code rõ ràng hơn code quá clever.
- Type-safe.
- DTO validation.
- Exception có ý nghĩa.
- Transaction cho use case nhiều bước.
- Không làm side effect ẩn.
- Không hard-code magic string nếu có thể dùng constants/enum.

### 26.3. Khi không chắc

Không tự ý đoán schema hoặc nghiệp vụ quan trọng.

Hãy:

- Tìm trong spec/database/API contract.
- Nếu vẫn thiếu, tạo TODO rõ ràng hoặc hỏi lại team.
- Không sinh migration phá vỡ baseline.

### 26.4. Không được làm

Agent không được:

- Xóa module/bảng/cột lớn mà không có yêu cầu.
- Thêm framework mới không cần thiết.
- Tự ý chuyển ORM.
- Tự ý chuyển sang microservices.
- Tự ý thêm Kafka/Redis/Elastic/vector DB khi chưa được yêu cầu.
- Tự ý tích hợp OpenAI/open-source AI/local LLM.
- Tự ý thay đổi API contract chính thức.
- Viết code bỏ qua auth/permission cho endpoint nhạy cảm.
- Dùng `any` tràn lan.
- Dùng raw SQL không parameter binding.

---

## 27. Workflow triển khai một use case

Khi implement một use case, làm theo thứ tự:

1. Đọc `SPEC.md` của feature nếu có.
2. Đọc `PLAN.md` nếu có.
3. Đọc `TASKS.md` nếu có.
4. Kiểm tra API contract.
5. Kiểm tra database table liên quan.
6. Tạo/cập nhật DTO.
7. Tạo/cập nhật entity/repository nếu cần.
8. Viết service business logic.
9. Viết controller endpoint.
10. Thêm guard/permission.
11. Thêm transaction nếu cần.
12. Thêm audit/event/notification nếu cần.
13. Viết test.
14. Chạy lint/test/build.
15. Cập nhật docs nếu API/schema thay đổi.

---

## 28. Spec hierarchy đề xuất

Toàn bộ tài liệu đặc tả nên nằm trong `/spec`.

```text
/spec
  /global
    constitution.md
    system-arch.md
    security.md
    data-governance.md
    database.md
    api-guidelines.md

  /modules
    /auth
      module.md
      arch.md
      api.md
    /accounts
      module.md
      arch.md
      api.md
    /meetings
      module.md
      arch.md
      api.md
    /approvals
      module.md
      arch.md
      api.md
    /scheduling
      module.md
      arch.md
      api.md
    /rooms
      module.md
      arch.md
      api.md
    /equipment
      module.md
      arch.md
      api.md
    /iot
      module.md
      arch.md
      api.md
    /attendance
      module.md
      arch.md
      api.md
    /presence
      module.md
      arch.md
      api.md
    /utilization
      module.md
      arch.md
      api.md
    /live-meeting
      module.md
      arch.md
      api.md
    /recording
      module.md
      arch.md
      api.md
    /transcription
      module.md
      arch.md
      api.md
    /minutes
      module.md
      arch.md
      api.md
    /documents
      module.md
      arch.md
      api.md
    /notifications
      module.md
      arch.md
      api.md
    /reports
      module.md
      arch.md
      api.md
    /analytics
      module.md
      arch.md
      api.md
    /administration
      module.md
      arch.md
      api.md

  /features
    /auth
      /feat-login
        SPEC.md
        PLAN.md
        TASKS.md
      /feat-reset-password
        SPEC.md
        PLAN.md
        TASKS.md

    /meetings
      /feat-create-meeting
        SPEC.md
        PLAN.md
        TASKS.md
      /feat-update-meeting
        SPEC.md
        PLAN.md
        TASKS.md
      /feat-cancel-meeting
        SPEC.md
        PLAN.md
        TASKS.md

    /approvals
      /feat-approve-meeting-request
        SPEC.md
        PLAN.md
        TASKS.md

    /rooms
      /feat-room-booking
        SPEC.md
        PLAN.md
        TASKS.md

    /attendance
      /feat-attendance-tracking
        SPEC.md
        PLAN.md
        TASKS.md

    /recording
      /feat-recording-session
        SPEC.md
        PLAN.md
        TASKS.md
```

`spec/` là nơi định nghĩa rule/boundary/intent.  
`src/` là nơi hiện thực.  
Không nhét đặc tả nghiệp vụ chính thức rải rác trong code comment nếu chưa có trong spec.

---

## 29. Git / commit convention đề xuất

Dùng conventional commits:

```text
feat(meetings): create meeting endpoint
fix(rooms): prevent overlapping room booking
refactor(auth): extract permissions guard
chore(database): add meeting indexes
test(scheduling): add conflict checking tests
docs(api): update meeting contract
```

Scope nên là module name.

---

## 30. Build, lint, test command tham khảo

Tùy package manager thực tế của project, dùng một trong các nhóm sau.

Nếu dùng npm:

```bash
npm install
npm run start:dev
npm run build
npm run lint
npm run test
npm run test:e2e
```

Nếu dùng pnpm:

```bash
pnpm install
pnpm start:dev
pnpm build
pnpm lint
pnpm test
pnpm test:e2e
```

Migration TypeORM cần theo cấu hình thực tế của project. Không tự bịa command nếu package.json đã có script riêng.

---

## 31. Definition of Done cho backend feature

Một backend feature chỉ được coi là xong khi:

- Có endpoint/controller đúng API contract.
- Có DTO validation.
- Có service business logic đúng use case.
- Có permission guard nếu endpoint cần bảo vệ.
- Có transaction nếu use case thay đổi nhiều bảng.
- Có entity/repository/migration nếu cần thay đổi database.
- Có error handling rõ ràng.
- Có response format thống nhất.
- Có test cho logic quan trọng.
- Không phá module khác.
- Không làm lệch database baseline.
- Không hard-code secret/config.
- Build/lint/test pass theo khả năng của project.

---

## 32. Checklist nhanh cho coding agent

Trước khi trả code, tự kiểm tra:

```text
[ ] Tôi đã đọc đúng module/use case liên quan chưa?
[ ] Tôi có dùng đúng database table/column hiện có không?
[ ] Tôi có tự ý thêm schema ngoài yêu cầu không?
[ ] Endpoint có đúng REST convention/API contract không?
[ ] DTO đã validate input chưa?
[ ] Có cần auth/permission guard không?
[ ] Có cần transaction không?
[ ] Có cần audit log/event/notification không?
[ ] Có xử lý conflict/business error không?
[ ] Có tránh log dữ liệu nhạy cảm không?
[ ] Có test hoặc đề xuất test cho logic quan trọng không?
[ ] Có giữ AI Document ở trạng thái setup-only nếu chưa được yêu cầu không?
```

---

## 33. Ghi chú cuối cùng

Dự án này cần tính **logic, nhất quán và chuyên nghiệp** hơn là code nhanh nhưng lệch domain.

Ưu tiên của backend:

1. Đúng business rule.
2. Đúng database baseline.
3. Đúng API contract.
4. An toàn về auth/security/audit.
5. Dễ mở rộng nhưng không over-engineering.
6. Có thể demo và phát triển được trong phạm vi capstone.

Khi nghi ngờ, không tự ý mở rộng. Hãy giữ thiết kế đơn giản, rõ boundary, phù hợp NestJS + PostgreSQL và meeting lifecycle của dự án.
