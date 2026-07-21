# SPEC ALIGNMENT WITH DB V3.2 COMPACT (39 TABLES)

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-21 | Bổ sung Amendment MỞ RỘNG SCOPE SAVP (Đây là phần mở rộng của dự án): 4 bảng mới `zones`, `gate_access_logs`, `zone_presence_events`, `vehicle_control_list` + 2 cột `zone_id` + 1 unique index, đã qua Team Approval Gate và áp lên RDS. Cập nhật mục 2 (Amendment), 3.1 (nhóm 9), 15.1 (T3) và 16. | Mục 2, 3.1, 15.1, 16 |
| 2026-06-06 | Tạo tài liệu đối chiếu (Alignment Document) chính thức cho dự án Smart Meeting Room Monitoring and Presence Tracking System, căn cứ theo DB v3.2 Compact 39 Tables và Spec.md. | Toàn bộ file |

---

## 1. Executive Summary
Tài liệu này đóng vai trò là **tài liệu đồng hành (Companion Document)** đứng cạnh `docs/spec.md`. Nhằm mục đích đối chiếu và xử lý triệt để sự khác biệt (divergence) giữa cấu trúc dữ liệu mô tả trong tài liệu đặc tả của giáo viên (`docs/spec.md` - sử dụng Prisma ORM, khóa chính BIGINT, và khoảng 42–43 thực thể dữ liệu logic) với thiết kế cơ sở dữ liệu vật lý chính thức của nhóm (**Database v3.2 Compact gồm 39 bảng** - sử dụng TypeORM, PostgreSQL, và khóa chính UUID).

Tài liệu này phân tích chi tiết cách ánh xạ (mapping) toàn bộ các khái niệm nghiệp vụ từ đặc tả vào cấu trúc cơ sở dữ liệu rút gọn của nhóm, chứng minh rằng thiết kế 39 bảng là hoàn toàn đầy đủ để đáp ứng toàn bộ các Use Case cốt lõi và các quy tắc nghiệp vụ trong phạm vi Capstone, đồng thời đóng vai trò là kim chỉ nam kỹ thuật ngăn ngừa sự lệch pha dữ liệu (schema drift) trong suốt quá trình phát triển dự án.

> [!NOTE]
> **Quy tắc Companion Document:** Tài liệu này **KHÔNG** thay thế hay viết lại `docs/spec.md`. Mọi phần trong `docs/spec.md` không bị ảnh hưởng bởi các quyết định về DB Compact, TypeORM, hoặc các thay đổi về phạm vi (scope) thì **vẫn được xem là giữ nguyên và có hiệu lực thi hành**.

---

## 2. Final Decision
Nhóm thống nhất đưa ra quyết định tối hậu: **Giữ nguyên Database v3.2 Compact gồm 39 bảng làm cơ sở dữ liệu baseline chính thức cho dự án Capstone**.
- **Không thêm bất kỳ bảng mới nào** trong giai đoạn này để giữ vững sự đơn giản và hiệu năng của hệ thống.
- Mọi điều chỉnh (nếu có) đối với cơ sở dữ liệu vật lý chỉ giới hạn ở mức thêm cột nhỏ, index, hoặc ràng buộc (constraint) tối thiểu và **phải qua cổng phê duyệt của nhóm (Team Approval Gate)** trước khi thực hiện.
- Hệ thống backend triển khai trên nền tảng **NestJS + TypeORM + PostgreSQL**, không sử dụng Prisma.

> [!IMPORTANT]
> **AMENDMENT 2026-07-21 — MỞ RỘNG SCOPE SAVP (Đây là phần mở rộng của dự án):** Quyết định "Không thêm bất kỳ bảng mới nào" ở trên được nhóm **sửa đổi chính thức** khi dự án mở rộng scope thành **SAVP (Smart AI Vision Platform)**. Việc mở rộng **ĐÃ QUA cổng phê duyệt của nhóm (Team Approval Gate)**, do Hải thiết kế/thực thi, migration `20260721000001` → `20260721000007` đã merge vào `dev` và áp lên RDS chung. Cụ thể (ADD-ONLY, không đụng baseline 39 bảng):
> - **4 bảng mới:** `zones`, `gate_access_logs`, `zone_presence_events`, `vehicle_control_list` (nhóm chức năng thứ 9 — SAVP Campus Extension).
> - **2 cột mới:** `iot_devices.zone_id`, `iot_device_events.zone_id` (FK → zones, SET NULL, song song `room_id`).
> - **1 unique index mới:** `device_user_mappings(device_id, user_id) WHERE deleted_at IS NULL`.
>
> Chi tiết cột/index: `database_v3_2_compact_39_tables.md` → section "PHẦN MỞ RỘNG SAVP" (bảng #40-43). Quy tắc No-New-Table (mục 4.2) **vẫn giữ hiệu lực** cho mọi bảng khác — bảng mới tiếp theo (ví dụ security alerts / alert rules / person watchlist cho UC-113/114/116) vẫn phải qua Team Approval Gate trước khi tạo.

---

## 3. Baseline Decisions

### 3.1 Database Baseline
Cơ sở dữ liệu vật lý là PostgreSQL sử dụng cấu trúc **39 bảng** được phân bổ thành 8 nhóm chức năng chính:
1. **Identity & Access Control (7 bảng):** `departments`, `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `face_profiles`.
2. **Meeting Core & Scheduling (8 bảng):** `meetings`, `meeting_requests`, `meeting_participants`, `meeting_external_participants`, `meeting_agendas`, `meeting_recurrence_rules`, `meeting_notes`, `meeting_events`.
3. **Room & Utilization (5 bảng):** `rooms`, `room_bookings`, `room_booking_usages`, `no_show_cases`, `room_events`.
4. **Equipment, IoT & Capture Agent (6 bảng):** `equipments`, `iot_devices`, `device_user_mappings`, `iot_device_events`, `capture_sessions`, `capture_session_channels`.
5. **Attendance & Presence (3 bảng):** `attendance_records`, `attendance_events`, `presence_snapshots`.
6. **Recording, Media & Transcription (5 bảng):** `recording_configs`, `recording_sessions`, `recording_segments`, `media_files`, `transcripts`.
7. **Minutes & Knowledge Management (1 bảng):** `meeting_minutes`.
8. **Notification, Reporting & Administration (4 bảng):** `notifications`, `background_jobs`, `system_configs`, `audit_logs`.
9. **SAVP Campus Extension (4 bảng — Đây là phần mở rộng của dự án, thêm 2026-07-21):** `zones`, `gate_access_logs`, `zone_presence_events`, `vehicle_control_list`. Xem Amendment ở mục 2.

### 3.2 ORM Baseline
Dự án sử dụng **TypeORM** làm ORM chính. Toàn bộ các định nghĩa model, mối quan hệ và cơ chế migration sẽ tuân thủ các decorator và quy tắc của TypeORM. Quyết định này đã được thông qua chính thức trong các quyết định kiến trúc từ `ADR-001` đến `ADR-007` trong `docs/ARCHITECTURE_DECISIONS.md`.

### 3.3 PK Strategy Baseline
Toàn bộ các bảng trong cơ sở dữ liệu sử dụng **UUID** làm khóa chính (Primary Key) với giá trị mặc định được sinh tự động bởi PostgreSQL thông qua hàm `gen_random_uuid()` (yêu cầu kích hoạt extension `pgcrypto` trong file SQL).
- Quyết định này thay thế hoàn toàn cho chiến lược `BIGINT IDENTITY` hoặc `BIGINT Auto-Increment` được gợi ý trong `docs/spec.md`.
- Lý do: Phục vụ khả năng phân tán dữ liệu, tránh lộ ID tuần tự qua API, và đồng bộ tốt hơn với các thiết bị IoT/Camera Server ngoại vi.

### 3.4 Scope Baseline
- **Giới hạn AI & Document:** Các tính năng AI Document nâng cao như Vector DB, RAG pipeline, hay chunking/embedding tự động **không nằm trong phạm vi phiên bản hiện tại**. Bảng `documents` từ đặc tả gốc được loại bỏ; metadata tài liệu được gộp trực tiếp vào bảng `media_files`.
- **Giới hạn STT & Transcription:** Việc dịch âm thanh tự động (Auto Speech-to-Text) là **WON'T**. Bảng `transcripts` chỉ lưu thông tin dạng tĩnh (Cleaned/Raw text) và speaker segments dạng JSONB hỗ trợ tải lên thủ công hoặc giả lập.
- **Giới hạn Meeting Minutes:** Không áp dụng AI Draft Minutes tự động. Biên bản cuộc họp được quản lý tĩnh qua bảng `meeting_minutes` và lưu trữ file xuất bản ở `media_files`.

---

## 4. Alignment Principles

### 4.1 Mapping Priority Rules
Khi triển khai các tính năng nghiệp vụ, việc đối chiếu giữa Spec và DB vật lý được ưu tiên theo thứ tự sau:
1. Quyết định chính thức và yêu cầu trực tiếp mới nhất từ nhóm Capstone.
2. Cấu trúc bảng và các cột thực tế trong Database v3.2 Compact.
3. Tài liệu đối chiếu Alignment này.
4. Tài liệu đặc tả `docs/spec.md`.

### 4.2 No-New-Table Rule
Nghiêm cấm các coding agent hoặc developer tự ý tạo thêm bảng vật lý mới trong PostgreSQL database mà không có sự đồng thuận chính thức bằng văn bản từ nhóm. Mọi dữ liệu mở rộng phát sinh phải được ánh xạ vào các cột hiện có, các trường dữ liệu động JSONB, hoặc các dịch vụ lưu trữ ngoài (như Redis Cache đối với dữ liệu tạm).

### 4.3 Minimal Adjustment Policy
Mọi đề xuất điều chỉnh schema cơ sở dữ liệu vật lý phải thỏa mãn nguyên tắc **tối giản (minimal adjustments)**:
- Chỉ thêm cột nullable hoặc có giá trị mặc định để tránh phá vỡ dữ liệu cũ.
- Chỉ tạo thêm index hoặc check constraint khi cần tối ưu hiệu năng hoặc bảo vệ toàn vẹn dữ liệu.
- Mọi điều chỉnh phải được đánh dấu trạng thái chờ phê duyệt (Pending) trong tài liệu này cho đến khi có xác nhận chính thức từ nhóm.

---

## 5. Architecture Alignment

### 5.1 Schema Separation (Spec) vs Shared DB (Compact)
- **Spec.md (§A.7):** Gợi ý thiết kế chia tách schema logic hoặc vật lý rõ rệt giữa các phân hệ (Identity, Space Booking, In-Meeting, Audio Processing, AI Transcription).
- **DB Compact:** Sử dụng **một cơ sở dữ liệu PostgreSQL chia sẻ chung (Shared Database)**, phân chia ranh giới thông qua tiền tố tên bảng và cấu trúc Module NestJS độc lập tại tầng ứng dụng (`/src/modules/`). Ranh giới logic vẫn được bảo toàn chặt chẽ ở mức code mà không cần tăng độ phức tạp vận hành của hệ quản trị cơ sở dữ liệu.

### 5.2 Archive Strategy Alignment
- **Spec.md (§A.7):** Đề xuất bảng `audit_logs_archive` riêng biệt để lưu trữ nhật ký kiểm toán cũ nhằm giải phóng dung lượng cho bảng chính.
- **DB Compact:** Loại bỏ bảng `audit_logs_archive`. Thay vào đó, áp dụng chiến lược **PostgreSQL Native Partitioning (Phân vùng dữ liệu gốc)** trực tiếp trên bảng `audit_logs` dựa theo cột thời gian `created_at`. Dữ liệu lịch sử sẽ tự động được phân vùng vào các partition theo tháng/quý mà không làm tăng số lượng thực thể logic trong ORM.

### 5.3 Exclude Constraint Alignment
- **Spec.md (§A.7):** Yêu cầu ngăn chặn xung đột đặt phòng bằng ràng buộc loại trừ (`EXCLUDE`) trực tiếp trên bảng đặt phòng.
- **DB Compact:** Bản thiết kế compact bảo toàn yêu cầu này thông qua chỉ mục loại trừ trên bảng `room_bookings` dùng GIST index kiểm tra khoảng thời gian (`tstzrange`) chồng lấn của cùng một phòng họp (`room_id`), loại trừ các booking đã bị hủy hoặc giải phóng.

---

## 6. ORM Alignment: Prisma → TypeORM

Tầng ORM trong đặc tả gốc (`docs/spec.md`) dựa trên Prisma, cần được chuyển đổi tương đương sang các mẫu thiết kế của TypeORM như sau:

### 6.1 Model Definition Mapping
* **Prisma Pattern:**
  ```prisma
  model User {
    id        BigInt   @id @default(autoincrement())
    email     String   @unique
    createdAt DateTime @default(now()) @map("created_at")
  }
  ```
* **TypeORM Equivalent (Bắt buộc sử dụng trong dự án):**
  ```typescript
  @Entity('users')
  export class UserEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 255, unique: true })
    email: string;

    @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
    createdAt: Date;
    
    @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })
    deletedAt: Date;
  }
  ```

### 6.2 Migration Strategy Mapping
* **Prisma Pattern:** `prisma migrate dev` tự động sinh SQL từ schema.
* **TypeORM Equivalent:** Sử dụng các file migration viết tay bằng SQL thuần đặt trong `/src/database/migrations/` để kiểm soát chặt chẽ các thay đổi schema vật lý. Tránh lạm dụng `typeorm schema:sync` trên môi trường production.

### 6.3 Query Pattern Mapping
* **Prisma Pattern:** `prisma.user.findUnique({ where: { email } })`
* **TypeORM Equivalent:** `userRepository.findOne({ where: { email } })` hoặc sử dụng QueryBuilder cho các câu lệnh phức tạp.

### 6.4 Transaction Pattern Mapping
* **Prisma Pattern:** `prisma.$transaction([ ... ])`
* **TypeORM Equivalent:** Sử dụng `DataSource.transaction()` hoặc chạy qua `EntityManager` được truyền trong context của transaction để đảm bảo an toàn dữ liệu.

### 6.5 Exclude Constraint Handling in TypeORM
Do TypeORM không hỗ trợ đầy đủ các decorator cho ràng buộc loại trừ PostgreSQL GIST (`EXCLUDE USING GIST`), các ràng buộc này phải được tạo thủ công thông qua câu lệnh SQL trong file migration khởi tạo database hoặc chạy raw query trong migration:
```sql
ALTER TABLE room_bookings ADD CONSTRAINT exclude_room_booking_overlap 
EXCLUDE USING GIST (room_id WITH =, tstzrange(reserved_start_time, reserved_end_time) WITH &&) 
WHERE (status IN ('pending', 'approved', 'active'));
```

---

## 7. Table Mapping Overview

### 7.1 Master Mapping Table
Dưới đây là bảng đối chiếu tổng thể từ **~42-43 thực thể logic/bảng** được đề cập trong tài liệu đặc tả `docs/spec.md` sang **39 bảng vật lý thực tế** của Database v3.2 Compact:

| Spec Entity/Concept | DB Compact Table | Mapping Strategy | Coverage | Priority | Ghi chú |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `User` | `users` | Direct | ✅ Đủ | MUST | Khóa chính chuyển đổi từ BIGINT sang UUID. |
| `RefreshToken` | _(Không có)_ | Redis / Cache | ✅ Đủ | MUST | Quản lý token tạm thời và blacklist trên Redis. |
| `PasswordResetOTP` | _(Không có)_ | Redis / Cache | ✅ Đủ | MUST | OTP lưu Redis TTL; trạng thái lưu tại `users`. |
| `Department` | `departments` | Direct | ✅ Đủ | MUST | Lưu thông tin phòng ban trực thuộc. |
| `UserDepartment` | _(Không có)_ | Consolidated | ✅ Đủ | MUST | Chuyển thành mối quan hệ 1-N qua `users.department_id`. |
| `Role` | `roles` | Direct | ✅ Đủ | MUST | Quản lý vai trò bảo mật hệ thống. |
| `Permission` | `permissions` | Direct | ✅ Đủ | MUST | Quản lý quyền chi tiết dạng `module.action`. |
| `UserRole` | `user_roles` | Direct | ✅ Đủ | MUST | Bảng nối N-N giữa người dùng và vai trò. |
| `RolePermission` | `role_permissions` | Direct | ✅ Đủ | MUST | Bảng nối N-N giữa vai trò và quyền. |
| `FaceProfile` | `face_profiles` | Direct | ✅ Đủ | MUST | Đăng ký khuôn mặt điểm danh của người dùng. |
| `Room` | `rooms` | Direct | ✅ Đủ | MUST | Quản lý danh sách phòng họp và layout. |
| `RoomSeat` | _(Không có)_ | Consolidated | ✅ Đủ | SHOULD | Tích hợp sơ đồ ghế vào `rooms.layout_json`. |
| `RoomEquipmentAssignment` | _(Không có)_ | Consolidated | ✅ Đủ | SHOULD | Tích hợp thông tin lắp đặt vào bảng `equipments`. |
| `Equipment` | `equipments` | Direct | ✅ Đủ | MUST | Quản lý tài sản thiết bị phần cứng. |
| `IoTDevice` | `iot_devices` | Direct | ✅ Đủ | MUST | Định nghĩa endpoint kết nối kỹ thuật (Camera/Mic). |
| `DeviceUserMapping` | `device_user_mappings` | Direct | ✅ Đủ | MUST | Đồng bộ mã định danh person trên các thiết bị. |
| `IoTDeviceEvent` | `iot_device_events` | Direct | ✅ Đủ | MUST | Lưu trữ lịch sử thông điệp/sự kiện thô từ thiết bị. |
| `CaptureSession` | `capture_sessions` | Direct | ✅ Đủ | MUST | Quản lý phiên thu kỹ thuật của Capture Agent. |
| `CaptureSessionChannel` | `capture_session_channels` | Direct | ✅ Đủ | MUST | Ánh xạ kênh âm thanh với vị trí/người nói. |
| `Meeting` | `meetings` | Direct | ✅ Đủ | MUST | Thực thể lõi quản lý thông tin cuộc họp. |
| `MeetingOccurrence` | _(Không có)_ | Consolidated | ✅ Đủ | WON'T | Quản lý ngoại lệ định kỳ trực tiếp qua `meetings.parent_meeting_id`. |
| `MeetingRequest` | `meeting_requests` | Direct | ✅ Đủ | MUST | Quản lý các yêu cầu phê duyệt đặt phòng/gia hạn. |
| `BookingApproval` | _(Không có)_ | Consolidated | ✅ Đủ | MUST | Gộp vào trạng thái duyệt của `meeting_requests`. |
| `MeetingParticipant` | `meeting_participants` | Direct | ✅ Đủ | MUST | Thành viên cuộc họp nội bộ và trạng thái tham dự. |
| `MeetingExternalParticipant` | `meeting_external_participants` | Direct | ✅ Đủ | MUST | Khách mời bên ngoài tổ chức. |
| `Agenda` | `meeting_agendas` | Renamed | ✅ Đủ | MUST | Lịch trình và nội dung chi tiết cuộc họp. |
| `MeetingRecurrenceRule` | `meeting_recurrence_rules` | Direct | ✅ Đủ | WON'T | Định nghĩa quy tắc họp lặp (Logic lặp là WON'T). |
| `MeetingNote` | `meeting_notes` | Direct | ✅ Đủ | MUST | Ghi chú trong phiên họp. |
| `MeetingEvent` | `meeting_events` | Direct | ✅ Đủ | MUST | Timeline trạng thái và nhật ký cuộc họp. |
| `ScheduleConflict` | _(Không có)_ | Computed | ✅ Đủ | SHOULD | Tính toán động; snapshot tại `meeting_requests`. |
| `RoomBooking` | `room_bookings` | Direct | ✅ Đủ | MUST | Bản ghi đặt phòng độc lập. |
| `RoomBookingUsage` | `room_booking_usages` | Direct | ✅ Đủ | MUST | Sử dụng phòng thực tế để đo lường hiệu năng. |
| `NoShowLog` | `no_show_cases` | Renamed | ✅ Đủ | MUST | Xử lý các trường hợp đặt phòng nhưng không dùng. |
| `RoomEvent` | `room_events` | Direct | ✅ Đủ | MUST | Nhật ký trạng thái phòng realtime. |
| `AttendanceRecord` | `attendance_records` | Direct | ✅ Đủ | MUST | Kết quả điểm danh tổng hợp cuối cùng. |
| `AttendanceEvent` | `attendance_events` | Direct | ✅ Đủ | MUST | Sự kiện điểm danh/nhận diện đơn lẻ. |
| `PresenceSnapshot` | `presence_snapshots` | Direct | ✅ Đủ | MUST | Snapshot hiện diện tức thời trong phòng họp. |
| `RecordingConfig` | `recording_configs` | Direct | ✅ Đủ | MUST | Cấu hình tham số ghi cuộc họp. |
| `RecordingSession` | `recording_sessions` | Direct | ✅ Đủ | MUST | Phiên ghi ghi hình/ghi âm cuộc họp thực tế. |
| `RecordingSegment` | `recording_segments` | Direct | ✅ Đủ | MUST | Các phân đoạn âm thanh/hình ảnh nhỏ. |
| `AudioSegment` | _(Không có)_ | Consolidated | ✅ Đủ | MUST | Gộp chung với `recording_segments`. |
| `MediaFile` | `media_files` | Direct | ✅ Đủ | MUST | Kho lưu trữ metadata file dùng chung. |
| `Transcript` | `transcripts` | Direct | ✅ Đủ | COULD | Lưu trữ văn bản phiên họp tĩnh và segments. |
| `TranscriptSegment` | _(Không có)_ | Consolidated | ✅ Đủ | COULD | Gộp thành cột JSONB trong bảng `transcripts`. |
| `MeetingMinutes` | `meeting_minutes` | Direct | ✅ Đủ | COULD | Quản lý biên bản cuộc họp và quyết định. |
| `MinuteAttachment` | _(Không có)_ | Consolidated | ✅ Đủ | COULD | Sử dụng bảng `media_files` liên kết đa hình. |
| `MinuteLink` | _(Không có)_ | Consolidated | ✅ Đủ | COULD | Lưu trực tiếp cột FK trong bảng `meeting_minutes`. |
| `Document` | _(Không có)_ | Consolidated | ✅ Đủ | WON'T | File lưu tại `media_files`, cấu hình lưu tại `system_configs`. |
| `Notification` | `notifications` | Direct | ✅ Đủ | MUST | Trung tâm quản lý thông báo gửi đi. |
| `NotificationRecipient` | _(Không có)_ | Consolidated | ✅ Đủ | MUST | Lưu danh sách người nhận trực tiếp trong cột JSONB. |
| `BackgroundJob` | `background_jobs` | Direct | ✅ Đủ | MUST | Quản lý tác vụ chạy ngầm. |
| `ReportExport` | _(Không có)_ | Consolidated | ✅ Đủ | COULD | Sử dụng `background_jobs` và lưu file ở `media_files`. |
| `SystemConfiguration` | `system_configs` | Renamed | ✅ Đủ | MUST | Quản lý tham số cấu hình hệ thống động. |
| `SystemPolicy` | _(Không có)_ | Consolidated | ✅ Đủ | MUST | Lưu trữ cấu hình dạng JSONB tại `system_configs`. |
| `AuditLog` | `audit_logs` | Direct | ✅ Đủ | MUST | Nhật ký kiểm toán hoạt động hệ thống. |
| `UnknownFaceEvent` | _(Không có)_ | Consolidated | ✅ Đủ | MUST | Map vào `attendance_events` với `user_id = NULL`. |
| `PrivacyConsentLog` | _(Không có)_ | Consolidated | ✅ Đủ | SHOULD | Ghi nhận sự đồng ý qua `audit_logs` / `face_profiles`. |
| `DataDeletionRequest` | _(Không có)_ | Consolidated | ✅ Đủ | SHOULD | Quản lý qua `background_jobs` và `audit_logs`. |
| `RoomOccupancyHourly` | _(Không có)_ | Computed | ✅ Đủ | SHOULD | Tính toán thông qua SQL View hoặc Materialized View. |

### 7.2 DB Compact Tables Not in Spec
Dưới đây là các bảng vật lý được thiết kế thêm trong DB Compact v3.2 mà không xuất hiện dưới dạng bảng riêng trong đặc tả gốc, kèm theo lý do kỹ thuật:

1. `face_profiles`: Tách biệt hồ sơ khuôn mặt đăng ký của nhân viên ra khỏi cấu hình phần cứng thiết bị. Điều này giúp quản lý tập trung sự đồng ý của nhân sự và phiên bản model AI nhận diện.
2. `meeting_external_participants`: Đặc tả chỉ tập trung vào người dùng hệ thống (`User`). Bảng này giúp hỗ trợ khách ngoài tổ chức tham gia họp và nhận email lời mời họp/mã QR check-in.
3. `meeting_recurrence_rules`: Tách biệt quy tắc lặp (RRULE) ra khỏi cuộc họp, tránh lưu trữ lặp lại các chuỗi ký tự cấu hình phức tạp trên từng occurrence.
4. `meeting_events` & `room_events`: Áp dụng mẫu thiết kế Event Sourcing tối giản. Lưu trữ toàn bộ timeline lịch sử trạng thái của phòng họp và cuộc họp nhằm phục vụ tính năng audit chi tiết và vẽ biểu đồ dashboard chính xác.
5. `capture_sessions` & `capture_session_channels`: Quản lý runtime kỹ thuật của Capture Agent trong phòng họp độc lập với phiên ghi hình nghiệp vụ (`recording_sessions`). Điều này giúp cô lập lỗi phần cứng mạng/camera khi đang họp mà không làm hỏng file ghi âm nghiệp vụ.

---

## 8. Detailed Mapping by Domain

### 8.1 Identity & Access
- **Spec.md Target:** Thực thể `User`, `Role`, `Permission`, `UserRole`, `RolePermission`, `FaceProfile`, `RefreshToken`, `PasswordResetOTP`.
- **DB Compact Tables:** `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `face_profiles`.
- **ORM Translation:** Chuyển đổi toàn bộ khóa ngoại và mối quan hệ nối bảng sang TypeORM `@ManyToOne`, `@OneToMany` và `@ManyToMany`.
- **Key Divergence:** Khóa chính toàn bộ là `UUID`. Không có bảng vật lý cho `RefreshToken` (lưu Redis blacklist) và `PasswordResetOTP` (lưu Redis TTL).

### 8.2 Organization / Department
- **Spec.md Target:** Thực thể `Department`, `UserDepartment`.
- **DB Compact Tables:** `departments` và cột `users.department_id`.
- **Key Divergence:** Đặc tả gốc sử dụng bảng nối `UserDepartment` cho phép một nhân viên thuộc nhiều phòng ban. DB Compact đơn giản hóa mối quan hệ này thành một nhân viên chỉ thuộc duy nhất một phòng ban chính (`users.department_id` FK chỉ sang `departments.id`), giúp tối giản hóa việc phân quyền duyệt và lập báo cáo phòng ban.

### 8.3 Meeting Core & Scheduling
- **Spec.md Target:** Thực thể `Meeting`, `MeetingOccurrence`, `MeetingRequest`, `BookingApproval`, `MeetingParticipant`, `MeetingExternalParticipant`, `Agenda`, `MeetingRecurrenceRule`, `MeetingNote`, `MeetingEvent`.
- **DB Compact Tables:** `meetings`, `meeting_requests`, `meeting_participants`, `meeting_external_participants`, `meeting_agendas`, `meeting_recurrence_rules`, `meeting_notes`, `meeting_events`.
- **Key Divergence:** Loại bỏ bảng `MeetingOccurrence` và `BookingApproval`. Recurring meetings được quản lý bằng cách tự tham chiếu `meetings.parent_meeting_id` trỏ về meeting cha. Trạng thái đặt phòng được tích hợp thẳng vào `meeting_requests`.

### 8.4 Room & Utilization
- **Spec.md Target:** Thực thể `Room`, `RoomSeat`, `RoomBooking`, `RoomBookingUsage`, `NoShowLog`, `RoomEvent`.
- **DB Compact Tables:** `rooms`, `room_bookings`, `room_booking_usages`, `no_show_cases`, `room_events`.
- **Key Divergence:** Sơ đồ ghế ngồi (`RoomSeat`) được gộp vào cột `rooms.layout_json` kiểu JSONB. Nhật ký no-show đổi tên thành bảng `no_show_cases` để quản lý vòng đời cảnh báo và giải phóng phòng tự động (Auto-release).

### 8.5 Equipment / IoT / Capture Agent
- **Spec.md Target:** Thực thể `RoomEquipmentAssignment`, `Equipment`, `IoTDevice`, `DeviceUserMapping`, `IoTDeviceEvent`, `CaptureSession`, `CaptureSessionChannel`.
- **DB Compact Tables:** `equipments`, `iot_devices`, `device_user_mappings`, `iot_device_events`, `capture_sessions`, `capture_session_channels`.
- **Key Divergence:** Gỡ bỏ bảng `RoomEquipmentAssignment`. Việc gán thiết bị phần cứng vào phòng được thể hiện trực tiếp qua cột `equipments.current_room_id` FK nullable trỏ về `rooms.id`. Bảng `capture_session_channels` lưu trực tiếp thông tin vị trí ghế (`seat_code_snapshot`) và vùng (`room_zone_label`) dưới dạng text snapshot thay vì liên kết FK với bảng ghế cũ.

### 8.6 Attendance & Presence
- **Spec.md Target:** Thực thể `AttendanceRecord`, `AttendanceEvent`, `PresenceSnapshot`, `UnknownFaceEvent`.
- **DB Compact Tables:** `attendance_records`, `attendance_events`, `presence_snapshots`.
- **Key Divergence:** Loại bỏ bảng `UnknownFaceEvent`. Các phát hiện khuôn mặt lạ từ camera được ghi trực tiếp vào bảng `attendance_events` với giá trị cột `user_id = NULL`, `event_type = 'unknown_face'`, và liên kết ảnh chụp qua `evidence_media_file_id` FK trỏ sang bảng `media_files`.

### 8.7 Recording / Media / Transcription
- **Spec.md Target:** Thực thể `RecordingConfig`, `RecordingSession`, `RecordingSegment`, `AudioSegment`, `MediaFile`, `Transcript`, `TranscriptSegment`.
- **DB Compact Tables:** `recording_configs`, `recording_sessions`, `recording_segments`, `media_files`, `transcripts`.
- **Key Divergence:** Gộp `AudioSegment` vào bảng `recording_segments`. Loại bỏ bảng `TranscriptSegment`, danh sách đoạn hội thoại chi tiết được nén thành cột dữ liệu JSONB `transcripts.speaker_segments_json` để giảm tải số lượng bản ghi tạo ra liên tục trong cơ sở dữ liệu.

### 8.8 Minutes & Knowledge
- **Spec.md Target:** Thực thể `MeetingMinutes`, `MinuteAttachment`, `MinuteLink`, `Document`.
- **DB Compact Tables:** `meeting_minutes` và bảng chia sẻ `media_files`.
- **Key Divergence:** Loại bỏ hoàn toàn bảng `Document` (phạm vi AI document hoãn lại). Loại bỏ bảng junction `MinuteAttachment` và `MinuteLink`. Các tệp đính kèm biên bản được lưu trực tiếp trong `media_files` với cột `related_entity_type = 'meeting_minutes'` và `related_entity_id = meeting_minutes.id`. Liên kết transcript và recording được thực hiện qua hai cột FK `linked_transcript_id` và `linked_recording_file_id` ngay trên bảng `meeting_minutes`.

### 8.9 Notification / Reporting / Admin
- **Spec.md Target:** Thực thể `Notification`, `NotificationRecipient`, `BackgroundJob`, `ReportExport`, `SystemConfiguration`, `SystemPolicy`.
- **DB Compact Tables:** `notifications`, `background_jobs`, `system_configs`.
- **Key Divergence:** Gộp thông tin người nhận thông báo (`NotificationRecipient`) thành các trường JSONB: `recipient_user_ids_json`, `recipient_emails_json`, và `recipient_phones_json` trên bảng `notifications`. Bảng cấu hình hệ thống đổi tên thành `system_configs`. Các chính sách bảo mật/ghi hình (`SystemPolicy`) được lưu dưới dạng JSONB `system_configs.config_json` có số phiên bản (`version_no`).

### 8.10 Audit / Config / Background Jobs
- **Spec.md Target:** Thực thể `AuditLog`, `AuditLogArchive`, `DataDeletionRequest`, `PrivacyConsentLog`.
- **DB Compact Tables:** `audit_logs` và bảng đa năng `background_jobs`.
- **Key Divergence:** Không tạo bảng `AuditLogArchive` và các bảng yêu cầu quyền riêng tư vật lý. Nhật ký xóa dữ liệu và chấp thuận quyền riêng tư được lưu vết thông qua bảng `audit_logs` và xử lý bất đồng bộ qua `background_jobs` với `job_type` tương ứng.

---

## 9. Spec Tables Not Added and Their Compact Mapping

Dưới đây là chi tiết giải trình kỹ thuật và phương án thay thế cho toàn bộ **22 bảng** trong đặc tả gốc nhưng không được tạo trong Database v3.2 Compact:

1. `refresh_tokens`
   - *Phương án:* Lưu trữ trong Redis Cache có đặt thời gian hết hạn (TTL).
   - *Giải trình:* Tối ưu hóa hiệu năng xác thực, tránh ghi đĩa liên tục mỗi khi người dùng lấy lại token mới (refresh token flow). Danh sách đen token bị thu hồi (JWT blacklist) cũng được truy vấn trực tiếp trên Redis.
2. `password_reset_otps`
   - *Phương án:* Lưu trữ OTP trong Redis Cache với TTL (thường là 5 phút).
   - *Giải trình:* OTP reset mật khẩu là dữ liệu tạm thời, không cần lưu trữ vĩnh viễn trong PostgreSQL. Trạng thái mật khẩu được quản lý trực tiếp qua các cột `users.must_change_password` và `users.password_updated_at`.
3. `user_departments`
   - *Phương án:* Cột `users.department_id` FK trỏ sang bảng `departments`.
   - *Giải trình:* Thiết kế 1-N (một người thuộc một phòng ban) đơn giản và đủ đáp ứng nhu cầu tổ chức của Capstone. Nếu phát sinh trường hợp kiêm nhiệm, có thể bổ sung cột JSONB chứa danh sách phòng ban phụ.
4. `room_equipment_assignments`
   - *Phương án:* Cột `equipments.current_room_id` FK nullable trỏ về `rooms.id`.
   - *Giải trình:* Lược bỏ bảng nối. Bất kỳ lúc nào thiết bị cũng chỉ có thể ở trong tối đa một phòng họp hoặc ở trong kho (current_room_id = NULL). Lịch sử luân chuyển thiết bị được ghi lại thông qua bảng nhật ký `audit_logs`.
5. `meeting_occurrences`
   - *Phương án:* Bảng `meetings` tự tham chiếu qua cột `parent_meeting_id`.
   - *Giải trình:* Loại bỏ việc tách biệt cuộc họp và phiên họp đơn lẻ. Một chuỗi họp định kỳ sẽ tạo ra một cuộc họp cha (chứa cấu hình định kỳ) và các bản ghi cuộc họp con trỏ về cha qua `parent_meeting_id`.
6. `agendas`
   - *Phương án:* Đổi tên thành bảng `meeting_agendas`.
   - *Giải trình:* Chuẩn hóa tên bảng theo tiền tố module `meeting_` để quản lý phân hệ tốt hơn.
7. `meeting_extensions`
   - *Phương án:* Bảng `meeting_requests` (`request_type = 'extend_meeting'`) + bảng `meeting_events` (`event_type = 'extension_requested'`).
   - *Giải trình:* Các yêu cầu gia hạn thời gian họp được phê duyệt tự động/thủ công qua workflow của bảng `meeting_requests` và ghi nhận sự kiện lịch sử vào `meeting_events`.
8. `booking_approvals`
   - *Phương án:* Bảng `meeting_requests` (`request_type = 'book_room'`).
   - *Giải trình:* Quy trình duyệt phòng và duyệt cuộc họp được quy về một mối quản lý thống nhất trong bảng yêu cầu phê duyệt chung, giảm thiểu số lượng bảng nghiệp vụ duyệt.
9. `unknown_face_events`
   - *Phương án:* Bảng `attendance_events` (`user_id = NULL`, `event_type = 'unknown_face'`).
   - *Giải trình:* Khuôn mặt lạ thực chất là một sự kiện điểm danh bất thường. Việc gom chung giúp dễ dàng hiển thị timeline điểm danh tại phòng họp mà không cần truy vấn chéo nhiều bảng.
10. `room_occupancy_snapshots`
    - *Phương án:* Bảng `presence_snapshots` + bảng `room_events` (`event_type = 'occupancy_detected'`).
    - *Giải trình:* Dữ liệu hiện diện tức thời được lưu trữ và cập nhật trong `presence_snapshots` phục vụ WebSocket realtime. Các thay đổi trạng thái phòng được lưu trữ tại `room_events`.
11. `no_show_logs`
    - *Phương án:* Đổi tên thành bảng `no_show_cases`.
    - *Giải trình:* Mở rộng thực thể thành quản lý vòng đời trường hợp no-show (từ lúc phát hiện nguy cơ, gửi cảnh báo, chờ phản hồi, cho đến khi giải phóng phòng và xử lý phạt), thay vì chỉ lưu log tĩnh.
12. `email_outbox`
    - *Phương án:* Bảng `notifications` (`channel = 'email'`) + bảng `background_jobs` (`job_type = 'send_email'`).
    - *Giải trình:* Áp dụng Outbox Pattern thông qua việc ghi nhận thông báo vào bảng `notifications` và sử dụng BullMQ chạy ngầm quét hàng đợi bằng `background_jobs` để gửi mail đi, đảm bảo tính chống trùng lặp (idempotency).
13. `audio_segments`
    - *Phương án:* Bảng `recording_segments`.
    - *Giải trình:* Phiên họp hybrid có thể ghi âm cả kênh âm thanh tách biệt và kênh hình ảnh tích hợp. Bảng `recording_segments` đại diện chung cho cả phân đoạn âm thanh và phân đoạn video.
14. `transcript_segments`
    - *Phương án:* Cột dữ liệu JSONB `transcripts.speaker_segments_json`.
    - *Giải trình:* Giảm tải số lượng bảng ghi vật lý. Một cuộc họp dài có thể sinh ra hàng ngàn câu thoại nhỏ; việc lưu chúng trong một tài liệu JSONB có cấu trúc giúp truy vấn nhanh hơn và tránh phình dung lượng PostgreSQL nhanh chóng.
15. `meeting_minutes` (Bản thiết kế gốc của Spec)
    - *Phương án:* Bảng `meeting_minutes` trong DB Compact.
    - *Giải trình:* DB Compact giữ nguyên bảng này nhưng tối giản hóa bằng cách nén trường quyết định và action items thành các cột JSONB (`decisions_json`, `action_items_json`).
16. `minute_attachments`
    - *Phương án:* Bảng `media_files` (`related_entity_type = 'meeting_minutes'`).
    - *Giải trình:* Thiết kế tệp tin đính kèm đa hình (Polymorphic Association) giúp tái sử dụng bảng lưu trữ file `media_files` cho tất cả các đối tượng nghiệp vụ khác nhau mà không cần tạo bảng nối.
17. `minute_links`
    - *Phương án:* Cột FK `meeting_minutes.linked_transcript_id` và `meeting_minutes.linked_recording_file_id`.
    - *Giải trình:* Liên kết trực tiếp thay vì dùng bảng junction, do một biên bản họp thông thường chỉ gắn với tối đa một transcript chính thức và một file ghi âm hoàn chỉnh của cuộc họp đó.
18. `privacy_consent_logs`
    - *Phương án:* Bảng `audit_logs` + các trường xác nhận consent trên `face_profiles` (`consent_at`) và `meeting_participants`.
    - *Giải trình:* Nhật ký đồng ý ghi âm/sử dụng dữ liệu khuôn mặt được ghi nhận dấu vết bảo mật tại `audit_logs` để audit, trạng thái hiện tại được lưu trực tiếp trên thực thể liên quan.
19. `data_deletion_requests`
    - *Phương án:* Bảng `background_jobs` (`job_type = 'data_deletion'`) + bảng nhật ký `audit_logs`.
    - *Giải trình:* Các yêu cầu xóa dữ liệu cá nhân theo luật định được tiếp nhận và xếp vào hàng đợi xử lý bất đồng bộ trong bảng `background_jobs`, sau khi hoàn thành sẽ lưu vết vĩnh viễn tại `audit_logs`.
20. `system_configurations`
    - *Phương án:* Đổi tên thành bảng `system_configs`.
    - *Giải trình:* Chuẩn hóa tên bảng vật lý ngắn gọn hơn.
21. `audit_logs_archive`
    - *Phương án:* Áp dụng PostgreSQL Native Partitioning trên bảng `audit_logs`.
    - *Giải trình:* Phân chia dữ liệu vật lý theo thời gian trực tiếp trên bảng chính mà không làm tăng độ phức tạp của mã nguồn NestJS/TypeORM.
22. `room_occupancy_hourly`
    - *Phương án:* Sử dụng SQL Materialized View hoặc tính toán trực tiếp từ `room_events` và `room_booking_usages`.
    - *Giải trình:* Dữ liệu thống kê hiệu suất theo giờ có thể được tổng hợp định kỳ thông qua background job hoặc view tĩnh, không cần duy trì một bảng vật lý phải cập nhật liên tục.

---

## 10. Optional Minimal Schema Adjustments

> [!IMPORTANT]
> **Quy tắc phê duyệt của nhóm (Team Approval Gate):** Các thay đổi dưới đây chỉ là **đề xuất kỹ thuật tối thiểu** nhằm hỗ trợ tối đa các Use Case nghiệp vụ quan trọng. Các nhà phát triển **KHÔNG** được tự ý triển khai code database migration cho các phần này khi chưa có **sự phê duyệt chính thức từ nhóm**.

### 10.1 New Columns
Dưới đây là các cột đề xuất bổ sung vào các bảng hiện tại:

| # | Table | Column | Type | Lý do nghiệp vụ | Trạng thái phê duyệt |
|---|---|---|---|---|---|
| 1 | `meeting_participants` | `consent_recording` | `boolean DEFAULT false` | BR-PRIV-01: Ghi nhận sự đồng ý ghi âm/ghi hình của từng thành viên trước khi cuộc họp bắt đầu. | ⏳ Pending Approval |
| 2 | `meeting_participants` | `consent_at` | `timestamptz` | BR-PRIV-01: Ghi nhận thời điểm thành viên đồng ý ghi âm/ghi hình. | ⏳ Pending Approval |
| 3 | `rooms` | `requires_approval` | `boolean DEFAULT false` | BR-BOOK-01: Xác định phòng họp này có yêu cầu duyệt phê duyệt đặt phòng hay không. | ⏳ Pending Approval |
| 4 | `rooms` | `approver_strategy` | `varchar(30)` | BR-BOOK-01: Chiến lược duyệt phòng (Ví dụ: `DEPT_MANAGER`, `ROOM_OWNER`, `FIXED_USER`). | ⏳ Pending Approval |
| 5 | `rooms` | `default_approver_id` | `uuid FK -> users.id` | BR-BOOK-01: Người duyệt mặc định nếu chiến lược duyệt là chỉ định đích danh. | ⏳ Pending Approval |
| 6 | `iot_device_events` | `idempotency_key` | `varchar(128)` | Spec §A.8.2: Ngăn chặn xử lý trùng lặp các sự kiện nhận diện từ Camera/IoT gửi lên liên tục. | ⏳ Pending Approval |
| 7 | `attendance_events` | `idempotency_key` | `varchar(128)` | Spec §B.4 (UC-ATT-01): Tránh tạo bản ghi điểm danh trùng lặp do thiết bị bị lặp sự kiện mạng. | ⏳ Pending Approval |
| 8 | `meetings` | `version_no` | `integer DEFAULT 1` | Spec §A.7: Hỗ trợ cơ chế khóa lạc quan (Optimistic Locking) chống ghi đè dữ liệu khi nhiều người sửa lịch họp cùng lúc. | ⏳ Pending Approval |

### 10.2 New Indexes / Constraints
- **Chỉ mục loại trừ đặt phòng (Exclusion Constraint):**
  Xác thực ràng buộc loại trừ chống trùng phòng họp đã được thiết lập trong file SQL vật lý của dự án:
  ```sql
  ALTER TABLE room_bookings ADD CONSTRAINT exclude_room_booking_overlap 
  EXCLUDE USING GIST (room_id WITH =, tstzrange(reserved_start_time, reserved_end_time) WITH &&) 
  WHERE (status IN ('pending', 'approved', 'active'));
  ```
- **Chỉ mục chống trùng sự kiện (Unique Indexes):**
  Chỉ tạo các index này sau khi các cột tương ứng ở mục 10.1 được phê duyệt:
  1. `CREATE UNIQUE INDEX ux_iot_device_events_idempotency ON iot_device_events(idempotency_key) WHERE idempotency_key IS NOT NULL;`
  2. `CREATE UNIQUE INDEX ux_attendance_events_idempotency ON attendance_events(idempotency_key) WHERE idempotency_key IS NOT NULL;`

### 10.3 JSONB Schema Additions
Nhóm không thay đổi cấu trúc bảng, chỉ tài liệu hóa (document) cấu trúc dữ liệu mong muốn bên trong các cột JSONB của DB Compact để đảm bảo code NestJS map dữ liệu nhất quán:

1. `rooms.layout_json`
   ```json
   {
     "seats": [
       { "code": "SEAT_01", "label": "Ghế số 1", "x": 12.5, "y": 45.0, "associated_mic_device_id": "uuid-here" }
     ],
     "zones": [
       { "label": "Khu vực bàn chính", "polygon_coordinates": [[0,0], [10,0], [10,10], [0,10]] }
     ]
   }
   ```
2. `meeting_requests.conflict_summary_json`
   ```json
   {
     "conflicts": [
       {
         "type": "ROOM_OVERLAP",
         "conflicting_booking_id": "uuid-here",
         "time_range": "[2026-06-06 08:00:00+07, 2026-06-06 09:30:00+07]"
       },
       {
         "type": "REQUIRED_PARTICIPANT_BUSY",
         "user_id": "uuid-here",
         "conflicting_meeting_id": "uuid-here"
       }
     ]
   }
   ```
3. `meeting_minutes.action_items_json`
   ```json
   [
     {
       "title": "Cập nhật tài liệu API v1.1",
       "assignee_id": "uuid-here",
       "due_date": "2026-06-10T17:00:00Z",
       "status": "pending",
       "priority": "high"
     }
   ]
   ```
4. `transcripts.speaker_segments_json`
   ```json
   [
     {
       "speaker_id": "uuid-here",
       "start_ms": 12000,
       "end_ms": 18500,
       "text": "Chúng tôi đồng ý với phương án thiết kế cơ sở dữ liệu rút gọn gồm 39 bảng này.",
       "confidence": 0.96
     }
   ]
   ```
5. `notifications.recipient_user_ids_json`
   ```json
   [
     "uuid-user-1",
     "uuid-user-2"
   ]
   ```

---

## 11. Business Rules Impact Analysis

Dưới đây là phân tích mức độ đáp ứng các quy tắc nghiệp vụ cốt lõi (`docs/spec.md §B.5`) trên cơ sở dữ liệu vật lý 39 bảng:

1. **BR-ROLE-01 (RBAC mandatory):** Đáp ứng hoàn hảo thông qua các bảng `users`, `roles`, `permissions`, `user_roles`, và `role_permissions`. Cơ chế kiểm tra quyền dạng `permission_code` đảm bảo phân quyền động linh hoạt.
2. **BR-BOOK-01 (Room Booking Approval Policy):** Cần phê duyệt các cột đề xuất ở mục 10.1 (`rooms.requires_approval`, `rooms.approver_strategy`). Nếu không đổi DB, nhóm sẽ quản lý chính sách duyệt phòng thông qua cột cấu hình chung `system_configs.config_json` có key `room_booking_policies`.
3. **BR-BOOK-02 (Booking Conflict Prevention):** Ngăn chặn triệt để xung đột trùng lịch phòng ở mức vật lý bằng ràng buộc loại trừ đặt phòng `exclude_room_booking_overlap` trên bảng `room_bookings`.
4. **BR-BOOK-03 (Ad-hoc Booking limitation):** Giới hạn đặt phòng ad-hoc trực tiếp. Backend xác thực thông qua việc đọc cấu hình tại `system_configs` và ghi nhận bản ghi vào `room_bookings` với `booking_type = 'ad_hoc'`.
5. **BR-NS-01 (No-show Detection threshold):** Hệ thống quét tác vụ ngầm dựa trên thời gian bắt đầu họp trong `room_booking_usages.reserved_start_time`. Tham số ngưỡng phút (ví dụ: 15 phút) được lưu tại `system_configs` (`no_show_threshold_minutes`).
6. **BR-NS-02 (No-show warning timeline):** Vòng đời cảnh báo được lưu vết chi tiết trong bảng `no_show_cases` qua các cột `warning_sent_at` và `warning_deadline_at`.
7. **BR-NS-03 (Auto-release room on confirmed no-show):** Kích hoạt cập nhật trạng thái `room_bookings.status = 'released'` và giải phóng phòng họp vật lý (`rooms.current_status = 'available'`), đồng thời ghi nhận cờ `room_booking_usages.auto_released = true`.
8. **BR-MTG-OVERRUN-01 (Meeting overrun detection):** Backend kiểm tra sự kiện hiện diện từ camera của Capture Agent tại `presence_snapshots` khi thời gian họp đã quá giờ kết thúc kế hoạch (`meetings.end_time`).
9. **BR-MTG-OVERRUN-02 (Auto-extend conditions):** Gia hạn tự động nếu không có booking kế tiếp. Backend thực hiện truy vấn kiểm tra khoảng thời gian trống kế tiếp trên bảng `room_bookings` của phòng họp đó trước khi gia hạn.
10. **BR-MTG-OVERRUN-03 (Graceful termination):** Gửi cảnh báo giải phóng phòng họp qua WebSocket realtime tới dashboard màn hình trong phòng dựa trên timeline sự kiện tại `room_events`.
11. **BR-PRIV-01 (Recording Consent):** Đáp ứng thông qua đề xuất cột `meeting_participants.consent_recording` ở mục 10.1. Nếu chưa thêm cột, backend sử dụng bảng nhật ký `audit_logs` để lưu sự kiện người dùng bấm nút đồng ý ghi âm trên giao diện web/ứng dụng di động trước khi tham gia cuộc họp.
12. **BR-PRIV-02 (Data Retention enforcement):** Tác vụ ngầm BullMQ định kỳ đọc cấu hình ngày lưu trữ `recording_configs.retention_days` hoặc `system_configs`, sau đó quét các bản ghi quá hạn trong `recording_sessions` và kích hoạt xóa file vật lý trong kho lưu trữ, đồng thời đánh dấu `media_files.deleted_at = now()`.
13. **BR-AUDIT-01 (Immutable Audit Log):** Bảng `audit_logs` được cấu hình phân quyền ghi-đọc nghiêm ngặt, chỉ cho phép chèn dữ liệu (`INSERT`), không cho phép sửa đổi (`UPDATE`) hoặc xóa (`DELETE`) thông qua quyền truy cập cơ sở dữ liệu của backend.

---

## 12. Use Case Coverage Matrix

Dưới đây là ma trận đối chiếu mức độ bao phủ của Database v3.2 Compact đối với toàn bộ các Use Case nghiệp vụ từ tài liệu đặc tả `docs/spec.md §B.2`:

### 12.1 Chi tiết bao phủ các Use Case quan trọng (MUST & Critical UCs)

| UC ID | Tên Use Case | Độ ưu tiên | Trạng thái bao phủ bởi DB | Các bảng dữ liệu tác động vật lý |
| :--- | :--- | :--- | :--- | :--- |
| **UC-ATH-01** | User Login | MUST / Critical | ✅ Đầy đủ | `users`, `audit_logs`. |
| **UC-ATH-02** | User Logout | MUST | ✅ Đầy đủ | `audit_logs`, Redis token blacklist. |
| **UC-ACC-01** | Create User Profile | MUST | ✅ Đầy đủ | `users`, `departments`. |
| **UC-ACC-02** | Enroll Face Template | MUST | ✅ Đầy đủ | `face_profiles`, `media_files`. |
| **UC-SCH-01** | Create Meeting Request | MUST / Critical | ✅ Đầy đủ | `meetings`, `meeting_requests`, `meeting_participants`, `meeting_recurrence_rules`. |
| **UC-SCH-02** | Approve Meeting Request | MUST | ✅ Đầy đủ | `meeting_requests`, `meetings`, `room_bookings`. |
| **UC-SCH-03** | Resolve Schedule Conflicts | MUST | ✅ Đầy đủ | computed động từ `meetings` + `room_bookings`. Conflict snapshot lưu tại `meeting_requests.conflict_summary_json`. |
| **UC-RM-01** | Create/Update Room | MUST | ✅ Đầy đủ | `rooms`. Sơ đồ ghế lưu tại `rooms.layout_json`. |
| **UC-RM-02** | Set Room Availability | MUST | ✅ Đầy đủ | `rooms.is_active`, `rooms.current_status`. |
| **UC-RM-03** | Check Room Realtime Status | MUST / Critical | ✅ Đầy đủ | View `v_room_current_status` kết hợp từ `rooms`, `room_bookings`, `room_booking_usages`. |
| **UC-ATT-01** | Face Recognition Check-in | MUST / Critical | ✅ Đầy đủ | `attendance_records`, `attendance_events`, `device_user_mappings`. |
| **UC-ATT-02** | Manual Attendance Review | MUST | ✅ Đầy đủ | `attendance_records` (cột `attendance_status`, `verified_by`, `verified_at`). |
| **UC-NS-01** | Trigger No-show Warning | MUST / Critical | ✅ Đầy đủ | `no_show_cases` (trạng thái `warning_sent`), `notifications`. |
| **UC-NS-02** | Auto-release Unused Room | MUST / Critical | ✅ Đầy đủ | `no_show_cases` (trạng thái `released`), `room_bookings` (trạng thái `released`), `rooms` (trạng thái `available`). |
| **UC-REC-01** | Start/Stop Recording | MUST / Critical | ✅ Đầy đủ | `recording_sessions`, `capture_sessions`, `recording_segments`, `media_files`. |
| **UC-REC-02** | Manage Recording Consent | MUST | ✅ Đầy đủ | Đề xuất cột `meeting_participants.consent_recording` hoặc ghi nhật ký tại `audit_logs`. |
| **UC-REC-03** | Auto-purge Expired Recordings | MUST | ✅ Đầy đủ | background job quét `recording_sessions` và cập nhật `media_files.deleted_at`. |
| **UC-NOT-01** | Send System Notifications | MUST | ✅ Đầy đủ | `notifications` (lưu người nhận dạng JSONB), `background_jobs` (BullMQ queues). |

### 12.2 Tóm tắt bao phủ các Use Case mở rộng (SHOULD, COULD, WON'T) theo phân hệ

1. **Space Booking & Management (SHOULD / COULD):** Bao phủ đầy đủ. Bảng `room_bookings` hỗ trợ đầy đủ việc lập lịch và thay đổi vị trí họp. Các chính sách phê duyệt nâng cao được đơn giản hóa xử lý qua cấu hình JSON.
2. **IoT & Camera Integration (SHOULD):** Bao phủ đầy đủ. Bảng `iot_devices` và `iot_device_events` ghi nhận toàn bộ hoạt động của thiết bị ngoại vi. Các mapping thẻ định danh person được thực hiện qua `device_user_mappings`.
3. **Attendance & Presence Management (SHOULD):** Bao phủ đầy đủ. Sử dụng `presence_snapshots` lưu trữ trạng thái người dùng tức thời phục vụ hiển thị realtime cho WebSockets dashboard.
4. **Recording & Media Process (SHOULD):** Bao phủ đầy đủ. Tiến trình xử lý file media ngầm được phân luồng qua `background_jobs` (ví dụ: `media_processing`).
5. **Speech-to-Text & Transcription (COULD / WON'T):**
   - **UC-TRS-01** (Tải lên văn bản họp thủ công) = **COULD**: Hỗ trợ đầy đủ bằng cách cập nhật văn bản tĩnh vào bảng `transcripts`.
   - **UC-TRS-02** (Chỉnh sửa văn bản họp) = **COULD**: Cho phép cập nhật cột `transcripts.cleaned_text` và ghi nhận người sửa qua `edited_by`.
   - **UC-TRS-03** (Tự động nhận diện STT qua AI) = **WON'T**: Thiết kế bảng `transcripts` đã sẵn sàng, nhưng logic ứng dụng NestJS sẽ không phát triển module gọi API AI tự động nhận dạng trong Capstone v1.
6. **Meeting Minutes & Action Items (COULD / WON'T):**
   - **UC-MIN-01/02/03** (Tạo/Sửa/Ban hành biên bản họp tĩnh) = **COULD**: Đáp ứng hoàn toàn bằng cách chèn và cập nhật dữ liệu trên bảng `meeting_minutes`.
   - **UC-MIN-04** (AI tự động tóm tắt và dự thảo biên bản) = **WON'T**: Không triển khai logic gọi mô hình ngôn ngữ lớn (LLM) để dự thảo tự động; dữ liệu quyết định và action items được nhập thủ công từ client và lưu trữ dạng JSONB trong `meeting_minutes.decisions_json` và `action_items_json`.
7. **Recurring Meeting Management (WON'T):**
   - **UC-MTG-10** (Tạo chuỗi cuộc họp lặp lại): Xếp loại **WON'T** (Không triển khai logic lặp và tạo lịch tự động ở backend cho phiên bản Capstone này). Cơ sở dữ liệu vật lý giữ cấu trúc `meeting_recurrence_rules` và `meetings.parent_meeting_id` để sẵn sàng mở rộng trong tương lai mà không cần code logic chạy lịch lặp thực tế ở tầng NestJS.

---

## 13. Sequence Flow Alignment

Ánh xạ lại các luồng xử lý quan trọng (`docs/spec.md §A.8`) vào cấu trúc bảng thực tế của Database v3.2 Compact:

### 13.1 Luồng Đặt phòng & Duyệt họp (UC-SCH-01 & UC-SCH-02)
1. Người dùng gửi yêu cầu đặt lịch họp thông qua ứng dụng NestJS.
2. Hệ thống kiểm tra xung đột đặt phòng động bằng cách quét bảng `room_bookings` (Kiểm tra khoảng thời gian trùng lấn thông qua `reserved_start_time` và `reserved_end_time` của cùng một `room_id`).
3. Nếu không có xung đột, hệ thống chèn một bản ghi mới vào bảng `meetings` (trạng thái `status = 'pending_approval'`) và đồng thời chèn một bản ghi yêu cầu phê duyệt vào `meeting_requests` (loại `request_type = 'create_meeting'`, trạng thái `approval_status = 'pending'`).
4. Quản lý phòng hoặc người có thẩm quyền phê duyệt: Hệ thống cập nhật bảng `meeting_requests` (`approval_status = 'approved'`, cập nhật `decision_by` và `decision_at`).
5. Hệ thống kích hoạt tạo bản ghi đặt phòng chính thức trong bảng `room_bookings` (trạng thái `status = 'approved'`), đồng thời chuyển trạng thái cuộc họp `meetings.status = 'scheduled'`.
6. Hệ thống tạo tác vụ gửi email thông báo trong bảng `notifications` (kênh `channel = 'email'`, người nhận được nén trong cột `recipient_user_ids_json`). Tác vụ ngầm BullMQ quét bảng `background_jobs` để gửi mail đi.

### 13.2 Luồng Điểm danh Tự động qua Camera (UC-ATT-01)
1. Thiết bị Door Face Attendance Terminal hoặc Python Camera Service nhận diện khuôn mặt người tham gia tại cửa phòng họp.
2. Thiết bị gửi HTTP POST Callback (chứa mã định danh thiết bị và mã nhân viên) lên Gateway của NestJS Backend.
3. Backend tiếp nhận, chèn một bản ghi sự kiện thô vào bảng `iot_device_events` (`event_type = 'face_detected'`).
4. Backend đối chiếu mã nhân viên nhận được với bảng `device_user_mappings` (Tìm bản ghi khớp với `device_person_code` hoặc `device_person_id` để xác định `user_id` nội bộ tương ứng).
5. Sau khi xác định được danh tính nhân viên:
   - Hệ thống chèn một bản ghi sự kiện điểm danh chi tiết vào bảng `attendance_events` (`event_type = 'check_in'`, lưu trữ ID camera ở cột `device_id`).
   - Hệ thống thực hiện cập nhật hoặc chèn mới kết quả điểm danh tổng hợp trong bảng `attendance_records` (`is_present = true`, cập nhật `check_in_time = event_time`, chuyển trạng thái `attendance_status = 'present'`).
6. Hệ thống đồng thời phát thông điệp điểm danh thành công qua WebSocket Gateway để dashboard hiển thị tức thời ngoài cửa phòng họp, sử dụng dữ liệu cập nhật từ bảng `presence_snapshots`.

### 13.3 Luồng Phát hiện No-show & Tự động Giải phóng Phòng (UC-NS-01 & UC-NS-02)
1. Đến giờ bắt đầu cuộc họp kế hoạch (`room_booking_usages.reserved_start_time`), backend scheduler khởi chạy kiểm tra trạng thái sử dụng phòng họp thực tế.
2. Hệ thống kiểm tra trong khoảng thời gian quy định (Ví dụ: 15 phút, đọc từ `system_configs` cấu hình `no_show_threshold_minutes`):
   - Truy vấn bảng `presence_snapshots` để kiểm tra có phát hiện sự hiện diện của người dùng hay không.
3. Nếu không có bất kỳ ai xuất hiện trong phòng (Không có tín hiệu presence):
   - Hệ thống chèn một bản ghi cảnh báo nguy cơ no-show vào bảng `no_show_cases` (trạng thái `detection_status = 'risk'`).
   - Hệ thống sinh một thông báo nhắc nhở gửi tới người tổ chức cuộc họp (`meetings.organizer_id`), lưu thông tin vào bảng `notifications` (loại `notification_type = 'no_show_alert'`).
4. Hệ thống đặt hạn chót xác nhận (`no_show_cases.warning_deadline_at`). Sau thời gian này, nếu người tổ chức không bấm giữ phòng trên ứng dụng di động (Không có yêu cầu cập nhật gửi lên):
   - Hệ thống cập nhật bảng `no_show_cases` (`detection_status = 'released'`).
   - Hệ thống cập nhật trạng thái đặt phòng trong `room_bookings` (`status = 'released'`).
   - Giải phóng phòng họp vật lý trong bảng `rooms` (`current_status = 'available'`).
   - Ghi nhận cờ `room_booking_usages.auto_released = true` và ghi nhận nhật ký hoạt động vào bảng `audit_logs` (`action_type = 'release_room'`, `entity_type = 'rooms'`).

### 13.4 Luồng Ghi âm/Ghi hình Cuộc họp (UC-REC-01)
1. Khi cuộc họp bắt đầu thực tế (`meetings.actual_start_time` được ghi nhận), hệ thống NestJS backend đọc cấu hình ghi âm từ bảng `recording_configs` liên kết với cuộc họp.
2. Nếu cuộc họp được phép ghi âm và đã có sự đồng ý của các thành viên tham gia (Consent check):
   - Backend gửi lệnh WebSocket/HTTP khởi động phiên ghi âm tới Room Capture Agent vật lý trong phòng họp.
   - Hệ thống chèn bản ghi khởi động kỹ thuật vào bảng `capture_sessions` (trạng thái `session_status = 'active'`).
   - Hệ thống đồng thời chèn bản ghi quản lý phiên ghi âm nghiệp vụ vào bảng `recording_sessions` (trạng thái `status = 'recording'`).
3. Khi đang họp, Room Capture Agent thu âm và chia tách kênh nói theo từng micro/ghế ngồi, thông tin thiết lập kênh được liên kết qua bảng `capture_session_channels` (Lưu `seat_code_snapshot` và dự đoán `participant_user_id`).
4. Khi kết thúc phiên họp:
   - Backend gửi lệnh dừng ghi âm tới Capture Agent.
   - Hệ thống cập nhật bảng `capture_sessions` (`session_status = 'stopped'`, cập nhật `stopped_at`).
   - Hệ thống cập nhật bảng `recording_sessions` (`status = 'processing'`).
   - Thiết bị Capture Agent hoàn tất xuất file âm thanh/hình ảnh, tải tệp tin lên Server lưu trữ MinIO/S3 và tạo bản ghi metadata file trong bảng `media_files` (kiểu `file_type = 'audio'` hoặc `'video'`).
   - Hệ thống cập nhật liên kết file kết quả vào bảng `recording_sessions` (`storage_path` và cập nhật trạng thái `status = 'stopped'`).
   - Hệ thống tạo tác vụ chạy ngầm STT tĩnh xếp vào hàng đợi `background_jobs` (`job_type = 'transcription'`) nếu tính năng transcript được kích hoạt.

---

## 14. Risks and Trade-offs

Việc sử dụng thiết kế rút gọn Database v3.2 Compact gồm 39 bảng mang lại một số rủi ro kỹ thuật và sự đánh đổi (trade-offs) cần được kiểm soát trong quá trình code:

1. **Rủi ro phình dữ liệu JSONB:**
   - *Chi tiết:* Việc gộp segments hội thoại vào trường `transcripts.speaker_segments_json` và danh sách người nhận vào `notifications.recipient_user_ids_json` giúp giảm số lượng bảng liên kết nhưng làm phình kích thước dữ liệu của một hàng (row size) trong PostgreSQL.
   - *Giải pháp:* Coding agent/developer bắt buộc phải sử dụng các cơ chế cập nhật từng phần (JSONB modification operators) khi sửa đổi mảng JSON, tránh đọc toàn bộ mảng lên bộ nhớ NestJS rồi ghi đè ngược lại cơ sở dữ liệu.
2. **Đánh đổi hiệu năng truy vấn chỉ mục JSONB:**
   - *Chi tiết:* Việc tìm kiếm từ khóa bên trong các trường văn bản lưu trong JSONB sẽ chậm hơn so với việc thiết kế bảng riêng có chỉ mục toàn văn (Full-Text Search - FTS) tiêu chuẩn.
   - *Giải pháp:* Nhóm sử dụng cơ chế tạo chỉ mục GIN (`USING GIN`) trên các cột JSONB nhạy cảm về tìm kiếm như `meeting_requests.conflict_summary_json` hoặc `meeting_minutes.action_items_json`.
3. **Mất lịch sử luân chuyển thiết bị vật lý:**
   - *Chi tiết:* Lược bỏ bảng `RoomEquipmentAssignment` đồng nghĩa với việc không có bảng lưu trữ lịch sử thiết bị này đã từng lắp ở những phòng nào trong quá khứ.
   - *Giải pháp:* Hệ thống bắt buộc phải ghi log chi tiết mọi thao tác thay đổi phòng của thiết bị vật lý (`equipments.current_room_id`) vào bảng nhật ký dùng chung `audit_logs` (`action_type = 'update'`, `entity_type = 'equipments'`).
4. **Hạn chế của thiết kế Single-Department:**
   - *Chi tiết:* Mối quan hệ 1-N giữa người dùng và phòng ban (`users.department_id`) sẽ gây khó khăn nếu trong tương lai công ty yêu cầu một quản lý kiểm soát nhiều phòng ban cùng lúc.
   - *Giải pháp:* Giải pháp tình thế là sử dụng bảng `roles` và phân quyền duyệt phòng theo chiến lược chỉ định đích danh nếu phát sinh nhu cầu kiêm nhiệm quản lý chéo bộ phận.

---

## 15. Confirmation Items

### 15.1 Team Baseline Decisions
Đây là các quyết định mang tính nền tảng đã được nhóm Capstone chốt nội bộ và không cần đặt câu hỏi lại cho giáo viên hướng dẫn. File Alignment này tài liệu hóa các quyết định này để làm bằng chứng thiết kế hệ thống:

- **T1 - Sử dụng UUID:** Toàn bộ khóa chính (PK) và khóa ngoại (FK) sử dụng kiểu dữ liệu UUID thay thế cho BIGINT. Quyết định này giúp nâng cao tính bảo mật và khả năng phân tán dữ liệu.
- **T2 - Sử dụng TypeORM:** Dự án dùng TypeORM làm framework ánh xạ đối tượng cơ sở dữ liệu chính式, thay thế cho Prisma ORM đề xuất trong đặc tả gốc.
- **T3 - Giới hạn 39 bảng vật lý:** Baseline cơ sở dữ liệu được chốt chặn cứng ở con số 39 bảng, không phát sinh thêm bảng mới trong giai đoạn phát triển Capstone hiện tại. *(Cập nhật 2026-07-21: nhóm phê duyệt thêm 4 bảng thuộc phần mở rộng SAVP — xem Amendment tại mục 2. Baseline 39 bảng gốc không đổi.)*
- **T4 - Cơ chế Xóa mềm (Soft Delete):** Áp dụng nhất quán cột `deleted_at` có kiểu dữ liệu `timestamptz` trên tất cả các bảng nghiệp vụ quan trọng và sử dụng tính năng `@DeleteDateColumn()` của TypeORM để tự động lọc dữ liệu đã xóa.
- **T5 - JWT Stateless Blacklist qua Redis:** Không tạo bảng quản lý session vật lý `refresh_tokens`. Thay vào đó sử dụng Redis để lưu trữ danh sách đen các token đã bị thu hồi hoặc đăng xuất.
- **T6 - Cơ chế truy cập cơ sở dữ liệu hỗn hợp (Hybrid DB Access):** Module xác thực (`auth`) được phép sử dụng raw SQL query để tối ưu hiệu năng đăng nhập; các module nghiệp vụ khác bắt buộc tuân thủ giao thức TypeORM Entity/Repository chuẩn hóa.
- **T7 - Gộp thực thể cuộc họp và phiên họp:** Không chia tách bảng `meeting_occurrences`. Chuỗi họp định kỳ được biểu diễn đơn giản hóa bằng mối quan hệ tự tham chiếu cha-con ngay trên bảng `meetings`.
- **T8 - Đóng băng logic cuộc họp lặp (Recurring logic is WON'T):** Logic sinh lịch họp định kỳ tự động ở backend là WON'T cho phiên bản này. Database giữ cấu trúc rules lặp chỉ để phục vụ khả năng tương thích đặc tả và mở rộng sau này.

### 15.2 Lecturer Confirmation Items
Đây là danh sách 10 điểm khác biệt (divergences) lớn nhất so với tài liệu đặc tả ban đầu của giáo viên hướng dẫn, cần được tài liệu hóa rõ ràng để giáo viên đánh giá và phê duyệt chấp nhận sự khác biệt này trong ngữ cảnh đơn giản hóa phạm vi dự án Capstone:

- **L1 - Khóa chính UUID:** Giáo viên hướng dẫn xác nhận chấp nhận việc chuyển đổi toàn bộ Primary Key từ kiểu số `BIGINT IDENTITY` sang kiểu chuỗi `UUID` để phù hợp với kiến trúc ứng dụng hiện đại.
- **L2 - Thay đổi ORM:** Giáo viên hướng dẫn xác nhận chấp nhận việc nhóm chuyển đổi từ Prisma sang TypeORM để tận dụng tối đa cơ chế cấu trúc module chặt chẽ của NestJS.
- **L3 - Đơn giản hóa chuỗi họp định kỳ:** Giáo viên hướng dẫn đồng ý phương án không tách bảng `meeting_occurrences` vật lý riêng biệt, quản lý chuỗi lặp trực tiếp bằng liên kết cha-con trên bảng `meetings`.
- **L4 - Không sử dụng bảng hàng đợi Email vật lý:** Giáo viên hướng dẫn đồng ý phương án loại bỏ bảng `email_outbox`, thay thế bằng việc tích hợp hàng đợi BullMQ trong NestJS kết hợp lưu vết thông báo tại bảng `notifications`.
- **L5 - Quản lý phiên đăng nhập không dùng bảng cơ sở dữ liệu:** Giáo viên hướng dẫn đồng ý việc quản lý token/session của người dùng hoàn toàn trên bộ nhớ đệm Redis Cache thay vì tạo bảng vật lý `refresh_tokens`.
- **L6 - Tích hợp sự kiện khuôn mặt lạ vào bảng điểm danh chung:** Giáo viên hướng dẫn đồng ý phương án gộp bảng `unknown_face_events` vào bảng sự kiện điểm danh `attendance_events` với cờ phân loại đặc biệt.
- **L7 - Lưu trữ hội thoại cuộc họp dạng tài liệu bán cấu trúc:** Giáo viên hướng dẫn đồng ý phương án nén mảng phân đoạn hội thoại của transcript thành cột JSONB `transcripts.speaker_segments_json` thay vì duy trì bảng liên kết 1-N `transcript_segments` có hàng triệu dòng dữ liệu thô.
- **L8 - Đơn giản hóa liên kết đa phương tiện của biên bản họp:** Giáo viên hướng dẫn đồng ý phương án loại bỏ các bảng junction đính kèm biên bản, quản lý thông qua cơ chế liên kết đa hình Polymorphic trên bảng lưu trữ file dùng chung `media_files`.
- **L9 - Đơn giản hóa nhật ký xóa dữ liệu và chấp thuận riêng tư:** Giáo viên hướng dẫn đồng ý phương án quản lý yêu cầu xóa và consent hoàn toàn thông qua việc ghi vết bảo mật trên bảng nhật ký hệ thống chung `audit_logs`.
- **L10 - Phân vùng nhật ký kiểm toán mức vật lý:** Giáo viên hướng dẫn đồng ý phương án thay thế bảng sao lưu nhật ký `audit_logs_archive` bằng cách áp dụng giải pháp phân vùng Native Partitioning trực tiếp trên bảng `audit_logs` của PostgreSQL.

---

## 16. Final Conclusion
Tài liệu đối chiếu này khẳng định: **Cấu trúc Database v3.2 Compact gồm 39 bảng hoàn toàn đủ năng lực lưu trữ và đáp ứng toàn bộ các nghiệp vụ, quy tắc an toàn dữ liệu và danh sách Use Case quy định trong Capstone**. Sự cắt giảm số lượng bảng từ đặc tả gốc không làm gãy hay suy giảm tính đúng đắn của hệ thống, mà giúp tối giản hóa mã nguồn NestJS, tăng tốc độ phát triển và giảm thiểu rủi ro xung đột cơ sở dữ liệu khi làm việc nhóm.

Mọi coding agent, trợ lý AI và lập trình viên tham gia dự án bắt buộc phải tuân thủ nghiêm ngặt cấu trúc 39 bảng baseline này, không tự ý đề xuất tạo thêm bảng vật lý mới và chỉ đề xuất các điều chỉnh tối thiểu đã liệt kê tại mục 10 sau khi được sự phê duyệt chính thức từ nhóm.

*(Cập nhật 2026-07-21: kết luận trên áp dụng cho baseline 39 bảng. Phần mở rộng SAVP — 4 bảng `zones`, `gate_access_logs`, `zone_presence_events`, `vehicle_control_list` — là ngoại lệ ĐÃ ĐƯỢC PHÊ DUYỆT, xem Amendment tại mục 2. Đây là phần mở rộng của dự án.)*

---

## Appendix A: Column-Level Diff for Key Tables

Dưới đây là bảng đối chiếu cấu trúc chi tiết từng cột (Column-level) giữa mô tả đặc tả gốc của giáo viên (Spec) và định nghĩa bảng vật lý thực tế trong Database v3.2 Compact của nhóm đối với các bảng cốt lõi:

### A.1 Bảng `users` (Users)
- *Khóa chính:* Spec gợi ý `BIGINT Auto-Increment` $\rightarrow$ DB Compact sử dụng `uuid PK DEFAULT gen_random_uuid()`.
- *Đối chiếu cột chi tiết:*

| Spec Column | DB Compact Column | Type | Match? | Ghi chú |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | `uuid PK` | ⚠️ Khác | Chuyển đổi kiểu dữ liệu khóa chính sang UUID. |
| `username` | `username` | `varchar(100)` | ✅ Khớp | Tên đăng nhập duy nhất của nhân sự. |
| `email` | `email` | `varchar(255)` | ✅ Khớp | Email liên hệ chính thức. |
| `password_hash` | `password_hash` | `varchar(255)` | ✅ Khớp | Mật khẩu băm an toàn. |
| `fullName` | `full_name` | `varchar(255)` | ⚠️ Khác | Chuyển từ camelCase sang snake_case. |
| `phone` | `phone_number` | `varchar(30)` | ⚠️ Khác | Đổi tên cột chuẩn hóa thông tin liên hệ. |
| `avatarUrl` | `avatar_url` | `text` | ⚠️ Khác | Chuyển từ camelCase sang snake_case. |
| `status` | `account_status` | `varchar(30)` | ⚠️ Khác | Đổi tên cột để tránh trùng tên với trạng thái nhân sự. |
| `passwordChangedAt` | `password_updated_at` | `timestamptz` | ⚠️ Khác | Đổi tên cột và sử dụng kiểu múi giờ timestamptz. |
| `mustChangePassword` | `must_change_password`| `boolean` | ⚠️ Khác | Chuyển từ camelCase sang snake_case. |
| _(Không có)_ | `employee_code` | `varchar(50)` | ➕ Thêm | Mã số nhân viên phục vụ import/export dữ liệu. |
| _(Không có)_ | `department_id` | `uuid FK` | ➕ Thêm | Thay thế cho bảng liên kết `user_departments`. |
| _(Không có)_ | `direct_manager_id` | `uuid FK` | ➕ Thêm | Quản lý trực tiếp để phục vụ phê duyệt tự động. |
| _(Không có)_ | `position_title` | `varchar(150)` | ➕ Thêm | Chức danh công việc của nhân viên. |
| _(Không có)_ | `employment_status` | `varchar(30)` | ➕ Thêm | Trạng thái hợp đồng lao động của nhân sự. |
| _(Không có)_ | `failed_login_count` | `integer` | ➕ Thêm | Đếm số lần đăng nhập lỗi hỗ trợ khóa tài khoản. |
| _(Không có)_ | `locked_until` | `timestamptz` | ➕ Thêm | Thời gian khóa tài khoản tạm thời. |
| _(Không có)_ | `deleted_at` | `timestamptz` | ➕ Thêm | Hỗ trợ cơ chế xóa mềm (Soft Delete). |

### A.2 Bảng `meetings` (Meetings)
- *Khóa chính:* Spec gợi ý `BIGINT Auto-Increment` $\rightarrow$ DB Compact sử dụng `uuid PK`.
- *Đối chiếu cột chi tiết:*

| Spec Column | DB Compact Column | Type | Match? | Ghi chú |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | `uuid PK` | ⚠️ Khác | Chuyển đổi kiểu dữ liệu khóa chính sang UUID. |
| `title` | `title` | `varchar(255)` | ✅ Khớp | Tiêu đề phiên họp. |
| `description` | `description` | `text` | ✅ Khớp | Mô tả nội dung chi tiết. |
| `startTime` | `start_time` | `timestamptz` | ⚠️ Khác | Chuyển sang snake_case và timestamptz. |
| `endTime` | `end_time` | `timestamptz` | ⚠️ Khác | Chuyển sang snake_case và timestamptz. |
| `status` | `status` | `varchar(30)` | ✅ Khớp | Trạng thái vòng đời cuộc họp. |
| `organizerId` | `organizer_id` | `uuid FK` | ⚠️ Khác | Chuyển kiểu dữ liệu sang UUID và snake_case. |
| `roomId` | `room_id` | `uuid FK` | ⚠️ Khác | Chuyển kiểu dữ liệu sang UUID và snake_case. |
| _(Không có)_ | `meeting_code` | `varchar(80)` | ➕ Thêm | Mã cuộc họp duy nhất phục vụ tra cứu. |
| _(Không có)_ | `host_id` | `uuid FK` | ➕ Thêm | Người chủ trì cuộc họp thực tế. |
| _(Không có)_ | `meeting_type` | `varchar(30)` | ➕ Thêm | Phân loại cuộc họp (emergency, training,...). |
| _(Không có)_ | `meeting_mode` | `varchar(30)` | ➕ Thêm | Hình thức họp (offline, online, hybrid). |
| _(Không có)_ | `visibility_level` | `varchar(30)` | ➕ Thêm | Quyền hạn hiển thị thông tin cuộc họp. |
| _(Không có)_ | `actual_start_time` | `timestamptz` | ➕ Thêm | Thời điểm bắt đầu cuộc họp thực tế. |
| _(Không có)_ | `actual_end_time` | `timestamptz` | ➕ Thêm | Thời điểm kết thúc cuộc họp thực tế. |
| _(Không có)_ | `parent_meeting_id` | `uuid FK` | ➕ Thêm | Tự liên kết hỗ trợ chuỗi họp định kỳ. |
| _(Không có)_ | `recurrence_rule_id` | `uuid FK` | ➕ Thêm | Liên kết quy tắc lặp nếu có chuỗi lặp. |
| _(Không có)_ | `deleted_at` | `timestamptz` | ➕ Thêm | Hỗ trợ cơ chế xóa mềm (Soft Delete). |

### A.3 Bảng `rooms` (Rooms)
- *Khóa chính:* Spec gợi ý `BIGINT Auto-Increment` $\rightarrow$ DB Compact sử dụng `uuid PK`.
- *Đối chiếu cột chi tiết:*

| Spec Column | DB Compact Column | Type | Match? | Ghi chú |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | `uuid PK` | ⚠️ Khác | Chuyển đổi kiểu dữ liệu khóa chính sang UUID. |
| `name` | `room_name` | `varchar(150)` | ⚠️ Khác | Đổi tên cột chuẩn hóa thông tin phòng. |
| `capacity` | `capacity` | `integer` | ✅ Khớp | Sức chứa tối đa của phòng họp. |
| `status` | `current_status` | `varchar(30)` | ⚠️ Khác | Đổi tên cột tránh trùng từ khóa hệ thống. |
| _(Không có)_ | `room_code` | `varchar(80)` | ➕ Thêm | Mã số phòng duy nhất để check-in/booking. |
| _(Không có)_ | `site_name` | `varchar(150)` | ➕ Thêm | Tên cơ sở/tòa nhà dạng text. |
| _(Không có)_ | `area_name` | `varchar(150)` | ➕ Thêm | Khu vực/tầng tọa lạc của phòng. |
| _(Không có)_ | `layout_json` | `jsonb` | ➕ Thêm | Sơ đồ vị trí ghế ngồi (Thay thế bảng `RoomSeat`). |
| _(Không có)_ | `has_camera` | `boolean` | ➕ Thêm | Cờ khai báo phòng có camera điểm danh. |
| _(Không có)_ | `has_microphone` | `boolean` | ➕ Thêm | Cờ khai báo phòng có mic thu âm. |
| _(Không có)_ | `allow_recording` | `boolean` | ➕ Thêm | Khai báo phòng cho phép ghi âm/ghi hình hay không. |
| _(Không có)_ | `deleted_at` | `timestamptz` | ➕ Thêm | Hỗ trợ cơ chế xóa mềm (Soft Delete). |

### A.4 Bảng `meeting_participants` (Meeting Participants)
- *Khóa chính:* Spec gợi ý `BIGINT Auto-Increment` $\rightarrow$ DB Compact sử dụng `uuid PK`.
- *Đối chiếu cột chi tiết:*

| Spec Column | DB Compact Column | Type | Match? | Ghi chú |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | `uuid PK` | ⚠️ Khác | Chuyển đổi kiểu dữ liệu khóa chính sang UUID. |
| `meetingId` | `meeting_id` | `uuid FK` | ⚠️ Khác | Chuyển sang UUID và snake_case. |
| `userId` | `user_id` | `uuid FK` | ⚠️ Khác | Chuyển sang UUID và snake_case. |
| `role` | `participant_role` | `varchar(40)` | ⚠️ Khác | Đổi tên cột tránh trùng quyền RBAC hệ thống. |
| _(Không có)_ | `is_required` | `boolean` | ➕ Thêm | Xác định thành viên bắt buộc tham dự cuộc họp. |
| _(Không có)_ | `attendance_required`| `boolean` | ➕ Thêm | Xác định thành viên có cần điểm danh tự động. |
| _(Không có)_ | `invitation_status` | `varchar(30)` | ➕ Thêm | Trạng thái lời mời họp (accepted, declined,...). |
| _(Không có)_ | `attendance_status` | `varchar(30)` | ➕ Thêm | Trạng thái điểm danh (present, absent, late,...). |
| _(Không có)_ | `joined_at` | `timestamptz` | ➕ Thêm | Thời điểm thực tế người dùng vào phòng họp. |
| _(Không có)_ | `left_at` | `timestamptz` | ➕ Thêm | Thời điểm thực tế người dùng rời phòng họp. |

### A.5 Bảng `attendance_events` (Attendance Events)
- *Khóa chính:* Spec gợi ý `BIGINT Auto-Increment` $\rightarrow$ DB Compact sử dụng `uuid PK`.
- *Đối chiếu cột chi tiết:*

| Spec Column | DB Compact Column | Type | Match? | Ghi chú |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | `uuid PK` | ⚠️ Khác | Chuyển đổi kiểu dữ liệu khóa chính sang UUID. |
| `meetingId` | `meeting_id` | `uuid FK` | ⚠️ Khác | Chuyển sang UUID và snake_case. |
| `userId` | `user_id` | `uuid FK` | ⚠️ Khác | Chuyển sang UUID và snake_case. Có thể NULL nếu là khuôn mặt lạ. |
| `roomId` | `room_id` | `uuid FK` | ⚠️ Khác | Chuyển sang UUID và snake_case. |
| `deviceId` | `device_id` | `uuid FK` | ⚠️ Khác | Chuyển sang UUID và snake_case. |
| `eventType` | `event_type` | `varchar(50)` | ⚠️ Khác | Chuyển sang snake_case (check-in, check-out, unknown_face,...). |
| `timestamp` | `event_time` | `timestamptz` | ⚠️ Khác | Đổi tên cột và sử dụng kiểu múi giờ. |
| `evidenceFileId` | `evidence_media_file_id` | `uuid FK` | ⚠️ Khác | Liên kết ảnh chụp bằng chứng sang `media_files`. |
| _(Không có)_ | `attendance_record_id` | `uuid FK` | ➕ Thêm | Liên kết ngược lại bản ghi tổng hợp `attendance_records`. |
| _(Không có)_ | `source_type` | `varchar(40)` | ➕ Thêm | Nguồn phát sinh sự kiện (door_camera, room_camera,...). |
| _(Không có)_ | `confidence_score` | `numeric(5,2)` | ➕ Thêm | Điểm tin cậy nhận dạng từ thuật toán AI. |
| _(Không có)_ | `review_status` | `varchar(30)` | ➕ Thêm | Trạng thái phê duyệt kiểm tra thủ công. |
| _(Không có)_ | `reviewed_by` | `uuid FK` | ➕ Thêm | Người kiểm tra phê duyệt sự kiện. |
| _(Không có)_ | `reviewed_at` | `timestamptz` | ➕ Thêm | Thời điểm phê duyệt kiểm tra. |
| _(Không có)_ | `metadata_json` | `jsonb` | ➕ Thêm | Thông tin kỹ thuật bổ sung (bounding box, face id,...). |

### A.6 Bảng `iot_device_events` (IoT Device Events)
- *Khóa chính:* Spec gợi ý `BIGINT Auto-Increment` $\rightarrow$ DB Compact sử dụng `uuid PK`.
- *Đối chiếu cột chi tiết:*

| Spec Column | DB Compact Column | Type | Match? | Ghi chú |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | `uuid PK` | ⚠️ Khác | Chuyển đổi kiểu dữ liệu khóa chính sang UUID. |
| `deviceId` | `device_id` | `uuid FK` | ⚠️ Khác | Chuyển sang UUID và snake_case. |
| `roomId` | `room_id` | `uuid FK` | ⚠️ Khác | Chuyển sang UUID và snake_case. |
| `meetingId` | `meeting_id` | `uuid FK` | ⚠️ Khác | Chuyển sang UUID và snake_case. |
| `eventType` | `event_type` | `varchar(60)` | ⚠️ Khác | Chuyển sang snake_case (heartbeat, error,...). |
| `timestamp` | `event_time` | `timestamptz` | ⚠️ Khác | Đổi tên cột và sử dụng kiểu múi giờ. |
| `payload` | `payload_json` | `jsonb` | ⚠️ Khác | Chuyển đổi từ String sang JSONB để tối ưu cấu trúc dữ liệu. |
| _(Không có)_ | `source_protocol` | `varchar(30)` | ➕ Thêm | Giao thức nhận tin (mqtt, rtsp, websocket,...). |
| _(Không có)_ | `severity` | `varchar(20)` | ➕ Thêm | Mức độ nghiêm trọng của sự kiện (info, error,...). |
| _(Không có)_ | `processed_status` | `varchar(30)` | ➕ Thêm | Trạng thái xử lý sự kiện trong backend. |
| _(Không có)_ | `error_message` | `text` | ➕ Thêm | Ghi nhận lỗi xử lý nếu có. |
| _(Không có)_ | `created_at` | `timestamptz` | ➕ Thêm | Thời điểm chèn sự kiện vào database. |

### A.7 Bảng `meeting_minutes` (Meeting Minutes)
- *Khóa chính:* Spec gợi ý `BIGINT Auto-Increment` $\rightarrow$ DB Compact sử dụng `uuid PK`.
- *Đối chiếu cột chi tiết:*

| Spec Column | DB Compact Column | Type | Match? | Ghi chú |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | `uuid PK` | ⚠️ Khác | Chuyển đổi kiểu dữ liệu khóa chính sang UUID. |
| `meetingId` | `meeting_id` | `uuid FK` | ⚠️ Khác | Chuyển sang UUID và snake_case. |
| `title` | `title` | `varchar(255)` | ✅ Khớp | Tiêu đề biên bản cuộc họp. |
| `content` | `minutes_content` | `text` | ⚠️ Khác | Đổi tên cột làm rõ ý nghĩa nội dung. |
| `status` | `status` | `varchar(30)` | ✅ Khớp | Trạng thái ban hành của biên bản họp. |
| `version` | `version_no` | `integer` | ⚠️ Khác | Đổi tên cột và định nghĩa dạng số nguyên. |
| _(Không có)_ | `visibility_level` | `varchar(30)` | ➕ Thêm | Quyền hạn xem biên bản họp. |
| _(Không có)_ | `attendees_snapshot_json` | `jsonb` | ➕ Thêm | Snapshot danh sách người họp thực tế tại thời điểm ban hành. |
| _(Không có)_ | `decisions_json` | `jsonb` | ➕ Thêm | Danh sách quyết định đã chốt trong cuộc họp. |
| _(Không có)_ | `action_items_json` | `jsonb` | ➕ Thêm | Danh sách action items được gán (Thay thế bảng `meeting_action_items`). |
| _(Không có)_ | `linked_transcript_id` | `uuid FK` | ➕ Thêm | Liên kết trực tiếp sang bảng `transcripts`. |
| _(Không có)_ | `linked_recording_file_id`| `uuid FK` | ➕ Thêm | Liên kết trực tiếp sang tệp ghi âm chính ở `media_files`. |
| _(Không có)_ | `issued_by` | `uuid FK` | ➕ Thêm | Người ban hành/kí duyệt biên bản họp. |
| _(Không có)_ | `issued_at` | `timestamptz` | ➕ Thêm | Thời điểm ban hành biên bản họp. |
| _(Không có)_ | `prepared_by` | `uuid FK` | ➕ Thêm | Người soạn thảo biên bản họp. |
| _(Không có)_ | `approved_by` | `uuid FK` | ➕ Thêm | Người duyệt biên bản họp. |
| _(Không có)_ | `approved_at` | `timestamptz` | ➕ Thêm | Thời điểm phê duyệt biên bản. |
| _(Không có)_ | `file_id` | `uuid FK` | ➕ Thêm | Liên kết file PDF/DOCX xuất bản chính trong `media_files`. |
| _(Không có)_ | `deleted_at` | `timestamptz` | ➕ Thêm | Hỗ trợ cơ chế xóa mềm (Soft Delete). |

### A.8 Bảng `notifications` (Notifications)
- *Khóa chính:* Spec gợi ý `BIGINT Auto-Increment` $\rightarrow$ DB Compact sử dụng `uuid PK`.
- *Đối chiếu cột chi tiết:*

| Spec Column | DB Compact Column | Type | Match? | Ghi chú |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | `uuid PK` | ⚠️ Khác | Chuyển đổi kiểu dữ liệu khóa chính sang UUID. |
| `type` | `notification_type` | `varchar(60)` | ⚠️ Khác | Đổi tên cột tránh trùng từ khóa hệ thống. |
| `subject` | `subject` | `varchar(255)` | ✅ Khớp | Tiêu đề thông báo gửi đi. |
| `content` | `content` | `text` | ✅ Khớp | Nội dung thông báo chi tiết. |
| `channel` | `channel` | `varchar(30)` | ✅ Khớp | Kênh truyền thông báo (email, in_app, sms,...). |
| `status` | `delivery_status` | `varchar(30)` | ⚠️ Khác | Đổi tên cột chi tiết hóa trạng thái gửi tin. |
| _(Không có)_ | `notification_code` | `varchar(100)` | ➕ Thêm | Mã thông báo để truy vết. |
| _(Không có)_ | `related_entity_type` | `varchar(60)` | ➕ Thêm | Loại đối tượng liên quan (meeting, booking,...). |
| _(Không có)_ | `related_entity_id` | `uuid` | ➕ Thêm | ID của đối tượng liên quan phục vụ đa hình. |
| _(Không có)_ | `recipient_scope` | `varchar(40)` | ➕ Thêm | Phạm vi người nhận (user_list, department,...). |
| _(Không có)_ | `recipient_user_ids_json` | `jsonb` | ➕ Thêm | Mảng ID người nhận (Thay thế bảng `notification_recipients`). |
| _(Không có)_ | `recipient_emails_json` | `jsonb` | ➕ Thêm | Mảng email người nhận bên ngoài hệ thống. |
| _(Không có)_ | `recipient_phones_json` | `jsonb` | ➕ Thêm | Mảng số điện thoại khách nhận tin SMS. |
| _(Không có)_ | `priority` | `varchar(20)` | ➕ Thêm | Mức độ ưu tiên gửi tin (low, normal, urgent,...). |
| _(Không có)_ | `scheduled_send_at` | `timestamptz` | ➕ Thêm | Thời điểm đặt lịch gửi tin. |
| _(Không có)_ | `sent_at` | `timestamptz` | ➕ Thêm | Thời điểm gửi thực tế. |
| _(Không có)_ | `read_count` | `integer` | ➕ Thêm | Số lượt người nhận đã đọc. |
| _(Không có)_ | `failure_reason` | `text` | ➕ Thêm | Ghi nhận nguyên nhân gửi lỗi nếu có. |
| _(Không có)_ | `retry_count` | `integer` | ➕ Thêm | Số lần thử lại khi gửi lỗi. |
| _(Không có)_ | `sent_by` | `uuid FK` | ➕ Thêm | Người thực hiện gửi tin thủ công. |
| _(Không có)_ | `payload_json` | `jsonb` | ➕ Thêm | Metadata và template variables của thông báo. |
| _(Không có)_ | `delivery_result_json` | `jsonb` | ➕ Thêm | Kết quả trả về từ nhà cung cấp dịch vụ gửi tin. |

### A.9 Bảng `background_jobs` (Background Jobs)
- *Khóa chính:* Spec gợi ý `BIGINT Auto-Increment` $\rightarrow$ DB Compact sử dụng `uuid PK`.
- *Đối chiếu cột chi tiết:*

| Spec Column | DB Compact Column | Type | Match? | Ghi chú |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | `uuid PK` | ⚠️ Khác | Chuyển đổi kiểu dữ liệu khóa chính sang UUID. |
| `queueName` | `queue_name` | `varchar(100)` | ⚠️ Khác | Chuyển sang snake_case và kiểu dữ liệu varchar. |
| `status` | `status` | `varchar(30)` | ✅ Khớp | Trạng thái hàng đợi của tác vụ ngầm. |
| _(Không có)_ | `job_type` | `varchar(80)` | ➕ Thêm | Loại tác vụ ngầm (import_accounts, send_email, transcription,...). |
| _(Không có)_ | `related_entity_type` | `varchar(60)` | ➕ Thêm | Loại đối tượng liên quan để xử lý đa hình. |
| _(Không có)_ | `related_entity_id` | `uuid` | ➕ Thêm | ID của đối tượng liên quan. |
| _(Không có)_ | `requested_by` | `uuid FK` | ➕ Thêm | Người yêu cầu kích hoạt tác vụ ngầm. |
| _(Không có)_ | `priority` | `integer` | ➕ Thêm | Độ ưu tiên của tác vụ trong hàng đợi. |
| _(Không có)_ | `scheduled_at` | `timestamptz` | ➕ Thêm | Hẹn giờ chạy tác vụ ngầm. |
| _(Không có)_ | `started_at` | `timestamptz` | ➕ Thêm | Thời điểm tác vụ bắt đầu chạy thực tế. |
| _(Không có)_ | `completed_at` | `timestamptz` | ➕ Thêm | Thời điểm tác vụ hoàn thành thực tế. |
| _(Không có)_ | `retry_count` | `integer` | ➕ Thêm | Đếm số lần tự động thử lại khi chạy lỗi. |
| _(Không có)_ | `input_json` | `jsonb` | ➕ Thêm | Tham số đầu vào có cấu trúc của job. |
| _(Không có)_ | `output_json` | `jsonb` | ➕ Thêm | Kết quả trả về sau khi job hoàn thành. |
| _(Không có)_ | `output_file_id` | `uuid FK` | ➕ Thêm | Liên kết file kết quả xuất bản trong `media_files` (Ví dụ: file report PDF). |
| _(Không có)_ | `error_message` | `text` | ➕ Thêm | Nội dung lỗi nếu tác vụ chạy thất bại. |
| _(Không có)_ | `metadata_json` | `jsonb` | ➕ Thêm | Thông tin kỹ thuật bổ sung của worker. |
