# Feature Specification: Import thành viên cuộc họp bằng Excel

- **Feature ID**: MEET-IMPORT-PARTICIPANT-001
- **Feature Name**: Import thành viên cuộc họp bằng Excel (Bulk Import Meeting Participants via Excel)
- **Module / Domain**: meetings
- **Created Date**: 2026-07-10
- **Status**: Draft
- **Source Documents**:
  - MEET-ADD-PARTICIPANT-001 (Thêm thành viên nội bộ thủ công)
  - MEET-ADD-EXTERNAL-PARTICIPANT-001 (Thêm khách mời ngoài)
  - Database v3.2 Compact (39 Tables)
  - CLAUDE.md / AGENTS.md (Backend Agent Guide v1.1)

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Khởi tạo spec cho tính năng import thành viên bằng Excel | Toàn bộ file |

---

## 1. Context & Goal

### 1.1 Bối cảnh
Hiện tại việc thêm thành viên vào cuộc họp chỉ hỗ trợ thêm **từng người một** qua 2 endpoint riêng lẻ (`participants/internal` và `participants/external`). Với các cuộc họp lớn (đào tạo, hội thảo, họp toàn phòng ban), người tổ chức phải thao tác lặp đi lặp lại rất tốn thời gian. Tính năng import bằng Excel cho phép nạp nhiều thành viên cùng lúc từ một file `.xlsx`, tăng trải nghiệm và giảm thao tác thủ công.

### 1.2 Mục tiêu
Cho phép Organizer/Host/Meeting Manager tải lên một file Excel chứa danh sách thành viên (cả **nội bộ** và **khách ngoài**) để thêm hàng loạt vào một cuộc họp cụ thể, với báo cáo kết quả **chi tiết từng dòng** (thành công / lỗi / cảnh báo), tái sử dụng toàn bộ business rule của luồng thêm đơn lẻ đã có.

### 1.3 Giá trị mang lại
- **Hiệu suất**: Thêm hàng chục thành viên trong một thao tác thay vì hàng chục request.
- **Trải nghiệm**: Có file template chuẩn để tải về, giảm lỗi định dạng đầu vào.
- **Minh bạch**: Trả kết quả partial-success theo từng dòng, người dùng biết chính xác dòng nào lỗi và lý do.
- **Nhất quán**: Không viết lại nghiệp vụ — mọi rule (conflict lịch, sức chứa, private, duplicate, audit) đều dùng lại logic hiện có.

### 1.4 Giả định
- Danh sách nhân viên nội bộ đã tồn tại trong bảng `users` (có `email` và/hoặc `employee_code`).
- Người thao tác đã được xác thực và có quyền quản lý cuộc họp liên quan.
- Thư viện `exceljs` (đã có sẵn trong dependencies) được dùng để parse/generate Excel.
- Dịch vụ gửi email dùng gói miễn phí có **giới hạn số lượng/ngày** → chỉ gửi email cho khách ngoài; nhân viên nội bộ nhận thông báo in-app.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Organizer / Host | Người tạo/chủ trì cuộc họp | Import thành viên vào cuộc họp mình quản lý (kể cả Private). Không được override sức chứa phòng vật lý. |
| Meeting Manager | Quản lý có quyền quản lý cuộc họp | Import cho các cuộc họp thông thường thuộc phạm vi quản lý. **Không** import vào cuộc họp Private trừ khi là Organizer/Host. |
| Admin | Quản trị viên hệ thống | Có quyền `meeting.participant.override_capacity`. Import được vào cả cuộc họp Private. |

### 2.2 Role & Permission Rules
- Phải có permission mới **`meeting.participant.import`** (gán cho ADMIN, MANAGER, EMPLOYEE).
- Quy tắc private meeting và capacity override **giống hệt** luồng thêm đơn lẻ (áp dụng per-row).
- **Private Meeting**: chỉ `organizer_id`, `host_id`, hoặc Admin (`admin.all`) mới được import.

### 2.3 Actor Constraints
- Actor phải đang ở trạng thái `active` và đã xác thực (Authenticated).

---

## 2.4 User Scenarios & Workflow

### 2.4.1 Preconditions
- Cuộc họp tồn tại và đang ở trạng thái `scheduled` hoặc `in_progress`.
- Actor có permission `meeting.participant.import` và quyền trên cuộc họp.
- File tải lên là `.xlsx` hợp lệ, đúng cấu trúc template, số dòng ≤ `MAX_IMPORT_ROWS` (mặc định 200).

### 2.4.2 Postconditions
- Với mỗi dòng hợp lệ nội bộ: bản ghi mới trong `meeting_participants`.
- Với mỗi dòng hợp lệ khách ngoài: bản ghi mới trong `meeting_external_participants`.
- Một bản ghi `audit_logs` tổng cho phiên import (kèm audit per-row từ logic tái sử dụng).
- Internal thêm thành công: **một** notification in-app gom cho toàn bộ danh sách (`recipient_user_ids_json`).
- External thêm thành công: mỗi khách một email mời (qua `notifications` + `background_jobs`).

### 2.4.3 Normal Flow (Luồng 2 bước xác nhận cảnh báo)
1. Actor tải file template (`GET .../import/template`), điền danh sách, tải lên (`POST .../import`, multipart).
2. Hệ thống parse file, validate cấu trúc (header, số dòng), phát hiện lỗi định dạng.
3. Hệ thống resolve định danh nội bộ: gom `email`/`employee_code` → 1 query batch tới `users`.
4. Hệ thống chạy pre-check per-row (**dry-run, chưa ghi DB**): meeting status, user tồn tại/active, duplicate (trong file & trong DB), private, conflict lịch, sức chứa phòng (tính lũy kế cả lô).
5. Phân loại mỗi dòng: `valid` / `warning` (conflict/capacity soft) / `error` (lỗi cứng).
6. **Nếu tồn tại dòng `warning` và `forceAddWithWarnings=false`**: trả `422 WARNING_CONFIRMATION_REQUIRED` kèm **báo cáo preview đầy đủ** từng dòng. **Không ghi DB**.
7. Actor xem preview, xác nhận, gọi lại API với **cùng file** + `forceAddWithWarnings=true`.
8. Hệ thống commit: thêm tất cả dòng không lỗi cứng (bao gồm dòng cảnh báo đã xác nhận), mỗi dòng trong transaction riêng.
9. Sau khi thêm xong: gửi thông báo (internal in-app gom 1 lần; external email từng người) — best-effort.
10. Trả `200` với báo cáo kết quả từng dòng: `successCount`, `failedCount`, `warningCount`, `results[]`.

---

## 3. Functional Requirements

### 3.1 File & Parsing Requirements
- **FR-001**: THE system SHALL cung cấp endpoint tải file Excel mẫu (template) chứa header chuẩn và dòng ví dụ.
- **FR-002**: THE system SHALL chỉ chấp nhận file định dạng `.xlsx` (MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) và từ chối định dạng khác với lỗi rõ ràng.
- **FR-003**: THE system SHALL parse file bằng `exceljs`, đọc sheet đầu tiên, ánh xạ cột theo header: `type`, `email`, `employee_code`, `full_name`, `organization_name`, `phone_number`.
- **FR-004**: THE system SHALL từ chối file rỗng (0 dòng dữ liệu) hoặc vượt quá `MAX_IMPORT_ROWS` (mặc định 200) với lỗi `IMPORT_ROW_LIMIT_EXCEEDED`.
- **FR-005**: THE system SHALL gắn số dòng gốc trong Excel vào từng kết quả để người dùng dễ đối chiếu.

### 3.2 Row Validation & Identity Resolution
- **FR-006**: FOR EACH dòng, THE system SHALL bắt buộc cột `type` ∈ {`internal`, `external`}; sai giá trị → dòng lỗi `INVALID_ROW_TYPE`.
- **FR-007**: FOR dòng `internal`, THE system SHALL resolve người dùng theo thứ tự ưu tiên: `email` trước, nếu trống thì `employee_code`. Nếu cả hai trống → lỗi `MISSING_IDENTIFIER`.
- **FR-008**: FOR dòng `internal`, IF không tìm thấy user hoặc user không `active`, THE system SHALL đánh dòng lỗi `USER_NOT_FOUND`.
- **FR-009**: FOR dòng `external`, THE system SHALL bắt buộc `full_name` và `email` hợp lệ; thiếu → lỗi `INVALID_EXTERNAL_ROW`.
- **FR-010**: THE system SHALL phát hiện trùng lặp **trong chính file** (cùng email/employee_code) và đánh dòng thứ hai trở đi là lỗi `DUPLICATE_IN_FILE`.
- **FR-011**: THE system SHALL phát hiện trùng với participant **đã có trong DB** và đánh lỗi `PARTICIPANT_ALREADY_EXISTS`.

### 3.3 Business Rule Reuse (Warning & Authorization)
- **FR-012**: THE system SHALL áp dụng đúng rule private meeting của luồng đơn lẻ: chỉ Organizer/Host/Admin được import vào cuộc họp `private`, ngược lại trả `403 FORBIDDEN_ACCESS` cho toàn bộ request.
- **FR-013**: THE system SHALL đánh giá conflict lịch (dùng lại `checkParticipantConflicts`) và sức chứa phòng cho các dòng `internal`; các cảnh báo soft → phân loại dòng là `warning`.
- **FR-014**: WHEN đánh giá sức chứa phòng, THE system SHALL tính **lũy kế** số người sẽ thêm trong cả lô (`currentCount + số dòng internal hợp lệ`) so với `rooms.capacity`, và đọc policy `meeting.capacity_policy` từ `system_configs`.
- **FR-015**: IF policy sức chứa là `block` và lô làm vượt sức chứa, THE system SHALL từ chối các dòng vượt sức chứa với lỗi cứng `ROOM_CAPACITY_EXCEEDED` (không phụ thuộc `forceAddWithWarnings`).

### 3.4 Two-step Confirmation (Batch-level)
- **FR-016**: WHEN tồn tại ít nhất một dòng `warning` và `forceAddWithWarnings` khác `true`, THE system SHALL trả `422 WARNING_CONFIRMATION_REQUIRED` kèm báo cáo preview từng dòng và **KHÔNG ghi bất kỳ dữ liệu nào vào DB**.
- **FR-017**: WHEN `forceAddWithWarnings=true`, THE system SHALL thêm tất cả dòng không lỗi cứng (bao gồm dòng cảnh báo). Dòng lỗi cứng vẫn bị loại và báo lý do.
- **FR-018**: IF một dòng cảnh báo có capacity warning nhưng actor không có permission `meeting.participant.override_capacity` (khi policy=`warning`), THE system SHALL chuyển dòng đó thành lỗi cứng `ROOM_CAPACITY_EXCEEDED` thay vì thêm.

### 3.5 Persistence & Partial Success
- **FR-019**: THE system SHALL xử lý **đồng bộ** và thêm mỗi dòng trong **một transaction riêng** (per-row), một dòng lỗi không rollback các dòng khác (partial success).
- **FR-020**: THE system SHALL tái sử dụng logic ghi lõi của luồng thêm đơn lẻ (participant + audit) thay vì viết lại; refactor tách phần notification ra khỏi lõi.
- **FR-021**: THE system SHALL trả về báo cáo tổng hợp: `totalRows`, `successCount`, `failedCount`, `warningCount`, và `results[]` gồm `{ row, type, identifier, status, reason?, participantId? }`.

### 3.6 Notification Requirements
- **FR-022**: WHEN có dòng `internal` được thêm thành công, THE system SHALL tạo **một** notification in-app gom (`recipient_scope='user_list'`, `recipient_user_ids_json=[tất cả userId vừa thêm]`) và **KHÔNG gửi email** cho nhân viên nội bộ.
- **FR-023**: WHEN có dòng `external` được thêm thành công, THE system SHALL enqueue email mời **riêng cho từng khách** (mỗi khách một `toEmails=[1 email]`) qua `notifications` + `background_jobs`.
- **FR-024**: THE system SHALL thực hiện notification theo dạng best-effort sau transaction; lỗi gửi thông báo KHÔNG làm hỏng kết quả import đã ghi.

### 3.7 Audit
- **FR-025**: WHEN phiên import hoàn tất, THE system SHALL ghi một `audit_logs` tổng (`action_type='IMPORT_PARTICIPANTS'`) gồm actor, meetingId, và số liệu tổng hợp (`totalRows`, `successCount`, `failedCount`).

---

## 4. Non-functional Requirements

- **NFR-001**: THE system SHALL xử lý file ≤ 200 dòng và phản hồi trong vòng dưới 10 giây trong điều kiện bình thường.
- **NFR-002**: THE system SHALL giới hạn kích thước file upload (mặc định ≤ 2MB) để tránh lạm dụng bộ nhớ.
- **NFR-003**: THE system SHALL không giữ toàn bộ file trong DB; chỉ parse trong bộ nhớ (memoryStorage) và loại bỏ sau xử lý.
- **NFR-004**: THE system SHALL đảm bảo mỗi dòng thêm là atomic (participant + audit trong cùng transaction).

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `meetings` | Kiểm tra status, room_id, visibility_level, thời gian | READ |
| `users` | Resolve internal theo email/employee_code, kiểm tra active | READ (batch) |
| `meeting_participants` | Thêm bản ghi internal | INSERT. Unique `(meeting_id, user_id)` |
| `meeting_external_participants` | Thêm bản ghi external | INSERT |
| `rooms` | Kiểm tra `capacity` | READ |
| `system_configs` | `meeting.capacity_policy` | READ |
| `notifications` | Notification in-app (internal) + email (external) | INSERT |
| `background_jobs` | Job gửi email external | INSERT |
| `audit_logs` | Audit per-row + audit tổng phiên import | INSERT |

### 5.2 Business Rules Impact
- **KHÔNG thay đổi schema.** Mọi bảng đã tồn tại trong v3.2 Compact.
- Không thêm bảng lưu lịch sử import (giữ scope tối thiểu); trạng thái import trả trực tiếp trong response.

---

## 6. Error Handling & Validation Rules

### 6.1 Lỗi cấp request (toàn file)
| Rule / Error Case | HTTP Status | Mã lỗi |
|---|---|---|
| File không phải `.xlsx` | 400 | `INVALID_FILE_FORMAT` |
| File rỗng / sai header | 400 | `INVALID_TEMPLATE` |
| Vượt số dòng tối đa | 400 | `IMPORT_ROW_LIMIT_EXCEEDED` |
| File vượt kích thước | 400 | `FILE_TOO_LARGE` |
| Meeting không tồn tại | 404 | `MEETING_NOT_FOUND` |
| Meeting sai trạng thái | 400 | `INVALID_MEETING_STATUS` |
| Không đủ quyền (private) | 403 | `FORBIDDEN_ACCESS` |
| Có dòng cảnh báo, chưa xác nhận | 422 | `WARNING_CONFIRMATION_REQUIRED` |

### 6.2 Lỗi cấp dòng (đưa vào `results[]`, không làm hỏng cả file)
| Row Error | Mã lỗi dòng |
|---|---|
| Sai giá trị `type` | `INVALID_ROW_TYPE` |
| Internal thiếu định danh | `MISSING_IDENTIFIER` |
| Không tìm thấy / inactive user | `USER_NOT_FOUND` |
| External thiếu full_name/email | `INVALID_EXTERNAL_ROW` |
| Trùng trong file | `DUPLICATE_IN_FILE` |
| Trùng participant trong DB | `PARTICIPANT_ALREADY_EXISTS` |
| Vượt sức chứa (block / no override perm) | `ROOM_CAPACITY_EXCEEDED` |

---

## 7. API Contract (Proposed)

### 7.1 Tải template
`GET /api/v1/meetings/:meetingId/participants/import/template`
- Trả về file `.xlsx` (Content-Type xlsx) với header chuẩn + dòng ví dụ + sheet hướng dẫn.

### 7.2 Import
`POST /api/v1/meetings/:meetingId/participants/import`
- **Content-Type**: `multipart/form-data`
- **Fields**: `file` (binary, required), `forceAddWithWarnings` (boolean, optional, default false)

**Response 422 (có cảnh báo, chưa xác nhận):**
```json
{
  "success": false,
  "error": {
    "code": "WARNING_CONFIRMATION_REQUIRED",
    "message": "Có dòng cảnh báo. Vui lòng xem lại và xác nhận.",
    "details": {
      "totalRows": 20,
      "warningCount": 2,
      "errorCount": 1,
      "results": [
        { "row": 2, "type": "internal", "identifier": "a@x.com", "status": "valid" },
        { "row": 3, "type": "internal", "identifier": "b@x.com", "status": "warning", "reason": "SCHEDULE_CONFLICT" },
        { "row": 4, "type": "internal", "identifier": "ghost@x.com", "status": "error", "reason": "USER_NOT_FOUND" }
      ]
    }
  }
}
```

**Response 200 (đã commit):**
```json
{
  "success": true,
  "message": "Import hoàn tất",
  "data": {
    "totalRows": 20,
    "successCount": 17,
    "failedCount": 2,
    "warningCount": 1,
    "results": [
      { "row": 2, "type": "internal", "identifier": "a@x.com", "status": "success", "participantId": "uuid" },
      { "row": 3, "type": "external", "identifier": "guest@ext.com", "status": "success", "participantId": "uuid" },
      { "row": 4, "type": "internal", "identifier": "ghost@x.com", "status": "failed", "reason": "USER_NOT_FOUND" }
    ]
  }
}
```

---

## 8. Acceptance Criteria

### 8.1 Parsing & Template
- **AC-001**: Given file `.pdf` được upload, hệ thống trả `400 INVALID_FILE_FORMAT`.
- **AC-002**: Given file `.xlsx` sai header, hệ thống trả `400 INVALID_TEMPLATE`.
- **AC-003**: Given file 201 dòng (MAX=200), hệ thống trả `400 IMPORT_ROW_LIMIT_EXCEEDED`.
- **AC-004**: Given `GET .../template`, hệ thống trả file `.xlsx` với đúng 6 cột header chuẩn.

### 8.2 Identity Resolution
- **AC-005**: Given dòng internal có `email` khớp user active, hệ thống resolve đúng userId và thêm thành công.
- **AC-006**: Given dòng internal `email` trống nhưng `employee_code` khớp, hệ thống fallback resolve đúng.
- **AC-007**: Given dòng internal cả email lẫn employee_code trống, dòng bị đánh `MISSING_IDENTIFIER`.
- **AC-008**: Given 2 dòng cùng email trong file, dòng thứ hai bị đánh `DUPLICATE_IN_FILE`.

### 8.3 Two-step Warning
- **AC-009**: Given file có 1 dòng conflict lịch và `forceAddWithWarnings=false`, hệ thống trả `422 WARNING_CONFIRMATION_REQUIRED`, không ghi DB.
- **AC-010**: Given gọi lại cùng file với `forceAddWithWarnings=true`, dòng cảnh báo được thêm và trả `200` với `status='success'`.
- **AC-011**: Given policy capacity=`block` và lô vượt sức chứa, các dòng vượt bị `ROOM_CAPACITY_EXCEEDED` dù `forceAddWithWarnings=true`.

### 8.4 Partial Success & Notification
- **AC-012**: Given file có dòng hợp lệ và dòng lỗi, hệ thống thêm dòng hợp lệ, báo lỗi dòng lỗi, không rollback toàn bộ.
- **AC-013**: Given có ≥1 internal thêm thành công, hệ thống tạo đúng **một** notification in-app gom và **không** enqueue email cho nội bộ.
- **AC-014**: Given có external thêm thành công, hệ thống enqueue email riêng cho từng khách ngoài.
- **AC-015**: Given phiên import hoàn tất, hệ thống ghi một `audit_logs` `IMPORT_PARTICIPANTS` với số liệu tổng.

### 8.5 Authorization
- **AC-016**: Given cuộc họp `private` và actor không phải Organizer/Host/Admin, hệ thống trả `403 FORBIDDEN_ACCESS` cho cả request.

---

## 9. Out of Scope

- Xử lý bất đồng bộ qua `background_jobs` cho phần parse/import (chỉ đồng bộ + cap dòng).
- Bảng lưu lịch sử/nhật ký import riêng (chỉ trả kết quả trong response + audit tổng).
- Thay đổi hành vi email của luồng thêm đơn lẻ (`addExternalParticipant` hiện KHÔNG gửi email — logic email external chỉ nằm trong import).
- Refactor worker gửi mail sang BCC/loop (giữ nguyên; import enqueue per-external để tránh lộ địa chỉ).
- Import cột role/attendance_required tùy biến (luôn mặc định `attendee`).
- Định dạng `.csv` (chỉ `.xlsx` trong phạm vi này).

---

## 10. Assumptions
- Client tải template chuẩn để điền → giảm rủi ro sai header.
- Với luồng 2 bước, client gửi lại **đúng file cũ** kèm `forceAddWithWarnings=true` (server không lưu file giữa 2 lần gọi).
- Số khách ngoài trong một lô thường nhỏ; enqueue email per-external không gây quá tải queue.
