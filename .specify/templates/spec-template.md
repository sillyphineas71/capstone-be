# Spec Template - Feature Specification

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Cập nhật quy tắc viết câu EARS: Giữ nguyên từ khóa cấu trúc bằng tiếng Anh, viết nội dung bằng tiếng Việt | Phần EARS Pattern & Quy tắc viết câu |

> File này dùng làm template cho Spec Kit / Codex CLI khi chạy `$speckit-specify`.
> Mục tiêu: tạo đặc tả tính năng rõ ràng, dễ kiểm tra, dễ chuyển tiếp sang plan/tasks/implementation.
>
> Ngôn ngữ chính: Tiếng Việt.
> Tuy nhiên, các câu **Functional Requirements**, **Error Requirements**, và các requirement quan trọng nên giữ nguyên keyword EARS bằng tiếng Anh để agent nhìn rõ cấu trúc, còn toàn bộ nội dung nghiệp vụ thì viết bằng tiếng Việt:
> `THE system SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF`, `THEN`.
>
> Quy tắc quan trọng:
> - Spec tập trung vào **WHAT** và **WHY**, chưa đi sâu vào **HOW**.
> - Không tự ý thêm feature ngoài tài liệu nguồn.
> - Không tự ý thêm bảng database mới nếu chưa có yêu cầu rõ ràng.
> - Nếu thiếu thông tin, ghi vào cuối phần liên quan dưới dạng `Cần làm rõ`.
> - Functional Requirements phải viết theo phong cách **EARS Requirements**.
> - Mỗi requirement phải có mã định danh rõ ràng để trace về plan, task, test case.
> - Trong requirement cuối cùng, **không viết** `Hệ thống phải...`, `Khi...`, `Nếu...` làm cấu trúc chính. Hãy dùng keyword EARS tiếng Anh.

---

# Feature Specification: [FEATURE_NAME]

- **Feature ID**: [Ví dụ: AUTH-LOGIN-001]
- **Feature Name**: [Tên tính năng]
- **Module / Domain**: [Ví dụ: auth, accounts, meetings, rooms, attendance, recording]
- **Created Date**: [YYYY-MM-DD]
- **Status**: Draft
- **Source Documents**:
  - [Tên tài liệu / file nguồn 1]
  - [Tên tài liệu / file nguồn 2]
  - [Tên tài liệu / file nguồn 3]

---

## Hướng dẫn viết EARS Requirements

Functional Requirements trong spec này phải ưu tiên viết theo EARS.
EARS giúp requirement rõ trigger, rõ điều kiện, rõ system response, dễ trace sang plan/task/test.

### EARS Keyword Rules

| Keyword | Vai trò | Khi nào dùng |
|---|---|---|
| `THE system SHALL` | Yêu cầu luôn đúng, không phụ thuộc event/state/option/error | Ubiquitous Requirement |
| `WHEN` | Trigger/event xảy ra tại một thời điểm | Event-driven Requirement |
| `WHILE` | Hành vi đúng trong suốt một trạng thái | State-driven Requirement |
| `WHERE` | Yêu cầu chỉ áp dụng khi feature/capability/config tồn tại | Optional Feature Requirement |
| `IF ... THEN` | Xử lý lỗi, ngoại lệ, điều kiện không mong muốn | Unwanted Behavior Requirement |

### Quy tắc viết câu EARS trong template này

```text
[Requirement ID]: [EARS keyword bằng tiếng Anh] [Nội dung điều kiện viết bằng tiếng Việt], THE system SHALL [Nội dung phản hồi viết bằng tiếng Việt].
```

Hoặc với lỗi/ngoại lệ:

```text
[Requirement ID]: IF [Nội dung lỗi/ngoại lệ viết bằng tiếng Việt], THEN THE system SHALL [Nội dung phản hồi viết bằng tiếng Việt].
```

Ví dụ mẫu:
- **Ubiquitous**: `THE system SHALL [Nội dung viết bằng tiếng việt]`
- **Event-driven**: `WHEN [Nội dung viết bằng tiếng việt], THE system SHALL [Nội dung viết bằng tiếng việt]`
- **State-driven**: `WHILE [Nội dung viết bằng tiếng việt], THE system SHALL [Nội dung viết bằng tiếng việt]`
- **Optional**: `WHERE [Nội dung viết bằng tiếng việt], THE system SHALL [Nội dung viết bằng tiếng việt]`
- **Unwanted Behavior**: `IF [Nội dung viết bằng tiếng việt], THEN THE system SHALL [Nội dung viết bằng tiếng việt]`

Quy tắc bắt buộc:

- BẮT BUỘC viết toàn bộ nội dung nghiệp vụ bên trong và sau các từ khóa bằng tiếng Việt để người dùng dễ đọc hiểu và kiểm soát nội dung, chỉ giữ các từ khóa cấu trúc EARS bằng tiếng Anh.
- Luôn có **một system response rõ ràng** sau `SHALL`.
- Không dùng từ mơ hồ như: nhanh, tốt, tiện lợi, tối ưu, thông minh nếu không có tiêu chí đo lường.
- Không gộp quá nhiều hành vi không liên quan vào cùng một requirement.
- Không mô tả chi tiết implementation như class, function, query SQL, ORM, thuật toán nội bộ nếu chưa cần.

---

## 0. EARS Requirement Patterns

### 0.1 Ubiquitous Requirement

Dùng cho yêu cầu luôn đúng trong mọi trường hợp, không cần trigger, không cần state, không cần option.

Format chuẩn:

```text
FR-XXX: THE system SHALL [mandatory behavior].
```

Ví dụ:

```text
FR-001: THE system SHALL store the creator user ID for every meeting created in the system.
```

Ví dụ tiếng Việt kết hợp keyword EARS:

```text
FR-001: THE system SHALL lưu lại `created_by` cho mỗi cuộc họp được tạo mới.
```

Không nên viết:

```text
FR-001: Hệ thống phải lưu lại thông tin người tạo cuộc họp.
```

### 0.2 Event-driven Requirement

Dùng khi hệ thống phản ứng sau một event/trigger.

Format chuẩn:

```text
FR-XXX: WHEN [trigger/event occurs], THE system SHALL [system response].
```

Ví dụ:

```text
FR-002: WHEN a user submits a meeting creation request, THE system SHALL validate room availability for the requested time range.
```

Ví dụ tiếng Việt kết hợp keyword EARS:

```text
FR-002: WHEN người dùng gửi yêu cầu tạo cuộc họp, THE system SHALL kiểm tra xung đột lịch của phòng họp được chọn.
```

### 0.3 State-driven Requirement

Dùng khi hành vi phải đúng trong suốt một trạng thái cụ thể.

Format chuẩn:

```text
FR-XXX: WHILE [state/precondition is true], THE system SHALL [system response].
```

Ví dụ:

```text
FR-003: WHILE a meeting is in `in_progress` status, THE system SHALL allow the host to end the meeting.
```

Ví dụ tiếng Việt kết hợp keyword EARS:

```text
FR-003: WHILE cuộc họp đang ở trạng thái `in_progress`, THE system SHALL cho phép host kết thúc cuộc họp.
```

### 0.4 Optional Feature Requirement

Dùng khi requirement chỉ áp dụng nếu hệ thống có một capability, config, module, device, integration, hoặc feature flag cụ thể.

Format chuẩn:

```text
FR-XXX: WHERE [optional feature/capability/configuration is included], THE system SHALL [system response].
```

Ví dụ:

```text
FR-004: WHERE recording is enabled for a room, THE system SHALL allow the host to start a recording session.
```

Ví dụ tiếng Việt kết hợp keyword EARS:

```text
FR-004: WHERE phòng họp có thiết bị ghi âm được cấu hình, THE system SHALL cho phép host bắt đầu recording session.
```

### 0.5 Unwanted Behavior Requirement

Dùng cho lỗi, ngoại lệ, failure, dữ liệu không hợp lệ, quyền không hợp lệ, conflict, hoặc tình huống không mong muốn.

Format chuẩn:

```text
FR-XXX: IF [unwanted condition/error/failure occurs], THEN THE system SHALL [safe system response].
```

Ví dụ:

```text
FR-005: IF a user does not have permission to create meetings, THEN THE system SHALL reject the request without creating a meeting record.
```

Ví dụ tiếng Việt kết hợp keyword EARS:

```text
FR-005: IF người dùng không có quyền tạo cuộc họp, THEN THE system SHALL từ chối yêu cầu và không tạo bản ghi cuộc họp.
```

---

## 0.6 Complex / Combined EARS Requirements

Dùng khi requirement cần kết hợp nhiều điều kiện. Chỉ dùng complex requirement khi thật sự cần; nếu câu quá dài hoặc có nhiều hành vi khác nhau, hãy tách thành nhiều requirement nhỏ.

### 0.6.1 State + Event

Dùng khi event chỉ được xử lý trong một state cụ thể.

```text
FR-XXX: WHILE [state/precondition is true], WHEN [trigger occurs], THE system SHALL [system response].
```

Ví dụ:

```text
FR-006: WHILE a meeting is in `scheduled` status, WHEN the host starts the meeting, THE system SHALL change the meeting status to `in_progress`.
```

### 0.6.2 Optional Feature + Event

Dùng khi event chỉ áp dụng nếu optional feature/capability/config tồn tại.

```text
FR-XXX: WHERE [optional feature/capability/configuration is included], WHEN [trigger occurs], THE system SHALL [system response].
```

Ví dụ:

```text
FR-007: WHERE room recording is enabled, WHEN the host starts recording, THE system SHALL create a recording session for the meeting.
```

### 0.6.3 Optional Feature + State

Dùng khi requirement chỉ đúng trong state cụ thể và chỉ áp dụng nếu optional feature tồn tại.

```text
FR-XXX: WHERE [optional feature/capability/configuration is included], WHILE [state/precondition is true], THE system SHALL [system response].
```

Ví dụ:

```text
FR-008: WHERE live transcription is enabled, WHILE a meeting is in `in_progress` status, THE system SHALL collect transcript segments from the capture service.
```

### 0.6.4 Optional Feature + State + Event

Dùng khi requirement phụ thuộc cả optional feature, state, và trigger.

```text
FR-XXX: WHERE [optional feature/capability/configuration is included], WHILE [state/precondition is true], WHEN [trigger occurs], THE system SHALL [system response].
```

Ví dụ:

```text
FR-009: WHERE room auto-release is enabled, WHILE a room booking is in `reserved` status, WHEN no participant checks in before the no-show threshold, THE system SHALL mark the booking as `no_show`.
```

### 0.6.5 State + Unwanted Behavior

Dùng khi lỗi/ngoại lệ chỉ cần xử lý trong một state cụ thể.

```text
FR-XXX: WHILE [state/precondition is true], IF [unwanted condition occurs], THEN THE system SHALL [safe system response].
```

Ví dụ:

```text
FR-010: WHILE a meeting is in `in_progress` status, IF the recording device becomes unavailable, THEN THE system SHALL keep the meeting active and record the device failure event.
```

### 0.6.6 Optional Feature + Unwanted Behavior

Dùng khi lỗi/ngoại lệ chỉ liên quan tới một optional feature/capability/config cụ thể.

```text
FR-XXX: WHERE [optional feature/capability/configuration is included], IF [unwanted condition occurs], THEN THE system SHALL [safe system response].
```

Ví dụ:

```text
FR-011: WHERE face check-in is enabled, IF the face recognition service is unavailable, THEN THE system SHALL allow authorized manual check-in according to the attendance policy.
```

---

## 0.7 EARS Quality Checklist

Trước khi hoàn tất Functional Requirements, kiểm tra từng requirement:

- [ ] Có requirement ID rõ ràng, ví dụ `FR-001`.
- [ ] Có đúng keyword EARS phù hợp: `THE system SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF`, `THEN`.
- [ ] Có đúng một system chính: `THE system` hoặc tên component cụ thể nếu cần, ví dụ `THE auth module`.
- [ ] Có hành vi rõ ràng sau `SHALL`.
- [ ] Có thể viết test case để kiểm chứng.
- [ ] Không dùng từ mơ hồ nếu không có tiêu chí đo.
- [ ] Không trộn nhiều hành vi không liên quan trong cùng một requirement.
- [ ] Không tự thêm feature, bảng, field, integration ngoài tài liệu nguồn.

---

## 1. Context & Goal

### 1.1 Bối cảnh

[Mô tả bối cảnh nghiệp vụ của tính năng. Giải thích vì sao tính năng này cần tồn tại trong hệ thống.]

Gợi ý cần làm rõ:

- Tính năng này thuộc module nào?
- Vấn đề hiện tại là gì?
- Tính năng này phục vụ phần nào trong meeting lifecycle?
- Tính năng này liên quan tới feature/use case nào trong tài liệu nguồn?
- Có phụ thuộc vào actor, room, meeting, device, IoT, recording, transcript, notification, hoặc approval flow nào không?

### 1.2 Mục tiêu

[Mô tả mục tiêu chính của tính năng.]

Ví dụ format:

```text
Mục tiêu của tính năng này là cho phép [actor] thực hiện [hành động/nghiệp vụ] nhằm [giá trị mang lại].
```

### 1.3 Giá trị mang lại

- [Giá trị cho người dùng]
- [Giá trị cho admin/quản trị hệ thống]
- [Giá trị cho vận hành/phòng họp/thiết bị]
- [Giá trị cho dữ liệu/báo cáo nếu có]

### 1.4 Giả định

- [Giả định 1]
- [Giả định 2]
- [Giả định 3]

### 1.5 Cần làm rõ

- [Câu hỏi cần làm rõ nếu thiếu thông tin]
- [Không tự bịa nếu tài liệu nguồn chưa nói rõ]

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| [Actor 1] | [Mô tả vai trò] | [Quyền/trách nhiệm] |
| [Actor 2] | [Mô tả vai trò] | [Quyền/trách nhiệm] |
| [Actor 3] | [Mô tả vai trò] | [Quyền/trách nhiệm] |

### 2.2 Role & Permission Rules

- [Role nào được phép thực hiện action nào]
- [Role nào chỉ được xem dữ liệu]
- [Role nào được duyệt/từ chối/cấu hình/quản trị]
- [Các giới hạn theo phòng ban, owner, participant, admin scope nếu có]

### 2.3 Actor Constraints

- [Điều kiện actor phải thỏa trước khi dùng tính năng]
- [Ví dụ: phải đăng nhập, phải có role, phải thuộc department, phải là host, phải là admin]

---

## 3. Functional Requirements

> Tất cả Functional Requirements phải viết theo EARS.
> Mỗi requirement phải rõ ràng, kiểm thử được, không mơ hồ.
> Keyword EARS phải giữ bằng tiếng Anh.
> Nội dung nghiệp vụ có thể viết tiếng Việt.

### 3.1 Core Requirements

```text
FR-001: THE system SHALL [hành vi bắt buộc cốt lõi].
FR-002: THE system SHALL [lưu/hiển thị/tính toán/cung cấp dữ liệu cốt lõi cần thiết].
FR-003: THE system SHALL [duy trì ràng buộc nghiệp vụ chính của feature].
```

### 3.2 Event-driven Requirements

```text
FR-004: WHEN [actor gửi yêu cầu/thực hiện action], THE system SHALL [phản hồi/hành vi cần xảy ra].
FR-005: WHEN [một bước nghiệp vụ hoàn tất], THE system SHALL [chuyển trạng thái/lưu dữ liệu/tạo thông báo].
FR-006: WHEN [dữ liệu hợp lệ được submit], THE system SHALL [xử lý nghiệp vụ tương ứng].
```

### 3.3 State-driven Requirements

```text
FR-007: WHILE [entity đang ở trạng thái cụ thể], THE system SHALL [cho phép/chặn/duy trì hành vi phù hợp].
FR-008: WHILE [session/request/booking/meeting đang active], THE system SHALL [duy trì dữ liệu/trạng thái/ràng buộc liên quan].
FR-009: WHILE [quy trình đang chờ xử lý], THE system SHALL [đảm bảo trạng thái không bị cập nhật trái quy trình].
```

### 3.4 Optional Feature Requirements

```text
FR-010: WHERE [capability/config/module/feature flag tồn tại], THE system SHALL [hành vi chỉ áp dụng khi capability đó được bật].
FR-011: WHERE [integration/device/service được cấu hình], THE system SHALL [tương tác hoặc sử dụng dữ liệu từ integration/device/service đó].
FR-012: WHERE [policy cụ thể được cấu hình], THE system SHALL [áp dụng policy đó cho nghiệp vụ].
```

### 3.5 Unwanted Behavior Requirements

```text
FR-013: IF [input không hợp lệ], THEN THE system SHALL [từ chối yêu cầu và trả về lỗi validation phù hợp].
FR-014: IF [actor không có quyền], THEN THE system SHALL [từ chối yêu cầu và không thay đổi dữ liệu].
FR-015: IF [business rule bị vi phạm], THEN THE system SHALL [từ chối thao tác và giữ dữ liệu ở trạng thái nhất quán].
FR-016: IF [dependency/service/device không khả dụng], THEN THE system SHALL [ghi nhận lỗi và xử lý an toàn theo policy].
```

### 3.6 Workflow Requirements

```text
FR-017: WHEN [actor] starts [workflow/process], THE system SHALL [khởi tạo trạng thái/dữ liệu đầu tiên].
FR-018: WHEN [workflow step] is completed, THE system SHALL [cập nhật trạng thái tiếp theo].
FR-019: WHILE [workflow đang ở trạng thái pending/processing], THE system SHALL [ngăn thao tác không hợp lệ hoặc trùng lặp].
FR-020: IF [workflow không thể tiếp tục do lỗi nghiệp vụ], THEN THE system SHALL [dừng workflow an toàn và trả về lý do phù hợp].
```

### 3.7 Authorization Requirements

```text
FR-021: IF the user is not authenticated, THEN THE system SHALL reject access to this feature.
FR-022: IF the user does not have `[permission_name]`, THEN THE system SHALL reject the request without modifying data.
FR-023: WHEN the user performs a protected action, THE system SHALL verify authorization before processing business logic.
FR-024: WHILE the user is acting within a limited scope, THE system SHALL restrict accessible data to the permitted scope.
```

### 3.8 Data & State Requirements

```text
FR-025: WHEN valid data is submitted, THE system SHALL persist the data with the correct initial status.
FR-026: WHEN the status of `[entity]` changes, THE system SHALL record the status change timestamp.
FR-027: IF `[entity]` is already in a terminal status, THEN THE system SHALL reject updates that violate the allowed state transition.
FR-028: WHILE `[entity]` is active, THE system SHALL maintain required relationships with related entities.
```

### 3.9 Notification / Audit Requirements

```text
FR-029: WHEN [important business event] occurs, THE system SHALL create notifications for [related actor/role].
FR-030: WHEN [actor] performs [important action], THE system SHALL record an audit log containing actor, action, timestamp, and related object.
FR-031: IF notification delivery fails, THEN THE system SHALL keep the main business transaction result unchanged and record the delivery failure.
```

### 3.10 Integration / Device Requirements

```text
FR-032: WHERE [external module/service/device] is configured, THE system SHALL validate related data before completing the business operation.
FR-033: WHEN [external event/message] is received, THE system SHALL map the event to the related business entity.
FR-034: IF [external module/service/device] does not respond, THEN THE system SHALL record the failure and return a safe status without corrupting primary business data.
FR-035: WHILE [device/session/integration] is active, THE system SHALL track status changes required by this feature.
```

### 3.11 Complex / Combined Requirements

```text
FR-036: WHILE [state/precondition is true], WHEN [trigger occurs], THE system SHALL [system response].
FR-037: WHERE [optional feature/capability/configuration is included], WHEN [trigger occurs], THE system SHALL [system response].
FR-038: WHERE [optional feature/capability/configuration is included], WHILE [state/precondition is true], THE system SHALL [system response].
FR-039: WHERE [optional feature/capability/configuration is included], WHILE [state/precondition is true], WHEN [trigger occurs], THE system SHALL [system response].
FR-040: WHILE [state/precondition is true], IF [unwanted condition occurs], THEN THE system SHALL [safe system response].
```

### 3.12 Requirement Notes

- [Ghi chú requirement 1 nếu cần]
- [Ghi chú requirement 2 nếu cần]
- [Không đưa implementation detail vào đây]

### 3.13 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | [Use case / tài liệu nguồn] | [Ghi chú] |
| FR-002 | Event-driven | [Use case / tài liệu nguồn] | [Ghi chú] |
| FR-003 | State-driven | [Use case / tài liệu nguồn] | [Ghi chú] |
| FR-004 | Optional Feature | [Use case / tài liệu nguồn] | [Ghi chú] |
| FR-005 | Unwanted Behavior | [Use case / tài liệu nguồn] | [Ghi chú] |
| FR-006 | Complex | [Use case / tài liệu nguồn] | [Ghi chú] |

---

## 4. Non-functional Requirements

> Non-functional Requirements cũng nên dùng `THE system SHALL` hoặc EARS conditional pattern nếu có điều kiện rõ ràng.

### 4.1 Performance

```text
NFR-001: THE system SHALL respond to primary operations within [X] seconds under normal load.
NFR-002: THE system SHALL support at least [N] concurrent requests for this feature if required by the source documents.
NFR-003: WHEN the request volume exceeds the supported threshold, THE system SHALL return a controlled error or throttling response according to project policy.
```

### 4.2 Security

```text
NFR-004: THE system SHALL require authentication before allowing access to protected feature data.
NFR-005: THE system SHALL enforce authorization for every operation that modifies business data.
NFR-006: THE system SHALL NOT expose unnecessary sensitive data in API responses.
NFR-007: IF a request contains invalid or expired credentials, THEN THE system SHALL reject the request.
```

### 4.3 Reliability & Consistency

```text
NFR-008: THE system SHALL prevent partial updates when a business transaction fails.
NFR-009: THE system SHALL keep related entity states consistent after successful business operations.
NFR-010: IF a required persistence operation fails, THEN THE system SHALL rollback the affected business operation where transaction support is required.
```

### 4.4 Usability

```text
NFR-011: THE system SHALL return clear error messages that the client can interpret or display.
NFR-012: THE system SHALL use field names and response formats consistent with the project API convention.
```

### 4.5 Observability

```text
NFR-013: THE system SHALL log important processing errors for this feature.
NFR-014: THE system SHALL record audit logs for actions that affect important business data.
NFR-015: WHEN an integration or device error occurs, THE system SHALL record enough diagnostic information for troubleshooting.
```

### 4.6 Maintainability

```text
NFR-016: THE system SHALL keep business logic separated by the appropriate module/domain boundary.
NFR-017: THE system SHALL provide test cases for success flows, validation failures, authorization failures, and major business rule failures.
```

---

## 5. Data Model

> Phần này mô tả dữ liệu ở mức nghiệp vụ.
> Không tự ý thêm bảng mới nếu database baseline chưa có.
> Nếu cần bảng/cột mới, phải ghi rõ là đề xuất và đưa vào `Cần làm rõ`.

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| [table/entity 1] | [Mô tả vai trò] | [Ghi chú] |
| [table/entity 2] | [Mô tả vai trò] | [Ghi chú] |
| [table/entity 3] | [Mô tả vai trò] | [Ghi chú] |

### 5.2 Dữ liệu đầu vào

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| [field_1] | [string/uuid/date/boolean/etc.] | Có/Không | [Mô tả] | [Rule] |
| [field_2] | [string/uuid/date/boolean/etc.] | Có/Không | [Mô tả] | [Rule] |

### 5.3 Dữ liệu đầu ra

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| [field_1] | [type] | [Mô tả] |
| [field_2] | [type] | [Mô tả] |

### 5.4 State / Status Model

| Status | Ý nghĩa | Có thể chuyển sang | Điều kiện chuyển |
|---|---|---|---|
| [status_1] | [Mô tả] | [status_2] | [Điều kiện] |
| [status_2] | [Mô tả] | [status_3] | [Điều kiện] |

### 5.5 Data Constraints

- [Ràng buộc dữ liệu 1]
- [Ràng buộc dữ liệu 2]
- [Unique constraint / foreign key / ownership rule nếu có]
- [Quy tắc không được xóa nếu đã có dữ liệu liên quan nếu có]

### 5.6 Data Lifecycle

- [Khi nào dữ liệu được tạo]
- [Khi nào dữ liệu được cập nhật]
- [Khi nào dữ liệu được hủy/xóa mềm]
- [Khi nào dữ liệu được dùng cho báo cáo/audit]

### 5.7 Data-related EARS Requirements

```text
FR-DATA-001: WHEN [entity] is created, THE system SHALL [persist required fields].
FR-DATA-002: WHEN [entity] is updated, THE system SHALL [preserve/update required fields according to business rules].
FR-DATA-003: IF [required relation/entity] does not exist, THEN THE system SHALL reject the request.
FR-DATA-004: IF [unique constraint/ownership rule] is violated, THEN THE system SHALL reject the request.
```

### 5.8 Cần làm rõ

- [Bảng/cột nào chưa chắc chắn]
- [Quan hệ dữ liệu nào cần xác nhận]
- [Có cần thêm field/table không, nếu tài liệu nguồn chưa đủ]

---

## 6. Error Handling

> Error requirements nên dùng `IF ... THEN THE system SHALL ...` để đúng EARS Unwanted Behavior Pattern.

### 6.1 Validation Errors

```text
ERR-001: IF `[field]` is missing, THEN THE system SHALL reject the request and return a validation error.
ERR-002: IF `[field]` has an invalid format, THEN THE system SHALL reject the request and return a validation error.
ERR-003: IF `[field]` exceeds the allowed limit, THEN THE system SHALL reject the request and return a validation error.
```

### 6.2 Authentication / Authorization Errors

```text
ERR-004: IF the user is not authenticated, THEN THE system SHALL return an authentication error.
ERR-005: IF the user does not have permission to perform the action, THEN THE system SHALL return an authorization error.
ERR-006: IF the authenticated user is outside the allowed data scope, THEN THE system SHALL reject access to the requested resource.
```

### 6.3 Business Rule Errors

```text
ERR-007: IF the request violates business rule `[rule_name]`, THEN THE system SHALL reject the request and return an appropriate business error.
ERR-008: IF the target object is in a status that does not allow the requested action, THEN THE system SHALL reject the request without modifying data.
```

### 6.4 Conflict Errors

```text
ERR-009: IF the requested operation conflicts with existing data, THEN THE system SHALL reject the request and return the required conflict details.
ERR-010: IF the data has been modified by another operation, THEN THE system SHALL handle the request according to the project concurrency policy.
```

### 6.5 Integration / Device / External Service Errors

```text
ERR-011: IF a dependent service/module does not respond, THEN THE system SHALL log the failure and return an appropriate error.
ERR-012: IF an IoT/capture/device component is unavailable, THEN THE system SHALL keep primary business data safe and record the device failure.
ERR-013: IF an external response cannot be mapped to a valid business entity, THEN THE system SHALL reject or quarantine the external event according to project policy.
```

### 6.6 Error Response Expectations

Response lỗi nên có tối thiểu:

| Field | Mô tả |
|---|---|
| `statusCode` | HTTP status code hoặc mã lỗi tương ứng |
| `message` | Thông báo lỗi có thể hiển thị/diễn giải |
| `error` | Loại lỗi ngắn gọn |
| `code` | Mã lỗi nội bộ nếu dự án có convention |
| `details` | Chi tiết lỗi validation/business nếu cần |
| `timestamp` | Thời điểm xảy ra lỗi |
| `path` | API path nếu áp dụng |

---

## 7. Acceptance Criteria

> Acceptance Criteria phải kiểm thử được.
> Ưu tiên format Given / When / Then.
> Acceptance Criteria không bắt buộc là EARS, nhưng phải trace được về FR/ERR/NFR.

### 7.1 Happy Path

```text
AC-001:
Given [bối cảnh hợp lệ],
When [actor thực hiện hành động],
Then [kết quả mong đợi phải xảy ra].
```

### 7.2 Validation Cases

```text
AC-002:
Given [dữ liệu thiếu hoặc không hợp lệ],
When [actor gửi yêu cầu],
Then the system rejects the request and returns the expected validation error.
```

### 7.3 Authorization Cases

```text
AC-003:
Given [actor không có quyền],
When [actor thực hiện hành động bị giới hạn],
Then the system rejects the request and does not modify data.
```

### 7.4 Business Rule Cases

```text
AC-004:
Given [dữ liệu/trạng thái vi phạm business rule],
When [actor thực hiện hành động],
Then the system rejects the request and returns the expected business error.
```

### 7.5 State Transition Cases

```text
AC-005:
Given [entity đang ở trạng thái A],
When [sự kiện hợp lệ xảy ra],
Then the system changes the entity status to B and records the status change timestamp.
```

### 7.6 Audit / Notification Cases

```text
AC-006:
Given [hành động quan trọng được thực hiện thành công],
When the system completes the operation,
Then the system records an audit log and/or creates notifications for related actors if required.
```

### 7.7 Integration / Device Cases

```text
AC-007:
Given [integration/device/service được cấu hình],
When [external event hoặc device event xảy ra],
Then the system maps the event to the correct business entity or records a controlled failure.
```

### 7.8 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-002 | [Mô tả test] |
| AC-002 | FR-013, ERR-001 | [Mô tả test] |
| AC-003 | FR-021, FR-022, ERR-005 | [Mô tả test] |
| AC-004 | FR-015, ERR-007 | [Mô tả test] |
| AC-005 | FR-026, FR-027 | [Mô tả test] |

---

## 8. Out of Scope

> Phần này rất quan trọng để agent không tự mở rộng feature.

Các nội dung sau **không thuộc phạm vi** của feature này:

- [Nội dung không làm 1]
- [Nội dung không làm 2]
- [Nội dung không làm 3]
- [Phần integration chưa triển khai nếu có]
- [Phần AI/automation/reporting nâng cao nếu chưa được yêu cầu]

### 8.1 Không triển khai trong feature này

- [Không implement API/logic nào]
- [Không xử lý module nào]
- [Không thêm bảng/cột nào]
- [Không tạo luồng nghiệp vụ nào]

### 8.2 Có thể xem xét ở feature khác

- [Ý tưởng hoặc phạm vi có thể tách sang feature khác]
- [Các enhancement sau này]
- [Các tích hợp phụ thuộc vào thiết bị/service khác]

### 8.3 Out-of-scope EARS Guardrails

Có thể viết thêm guardrail bằng EARS để agent không tự mở rộng:

```text
OOS-001: THE system SHALL NOT implement [out-of-scope feature] as part of this feature.
OOS-002: THE system SHALL NOT create new database tables or fields unless explicitly approved in this specification.
OOS-003: WHERE [future/optional module] is mentioned for context only, THE system SHALL NOT implement that module in this feature.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [ ] Spec đã có đủ 8 thành phần chính.
- [ ] Functional Requirements đã viết theo EARS.
- [ ] Requirement sử dụng keyword EARS bằng tiếng Anh: `THE system SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF`, `THEN`.
- [ ] Đã có đủ 5 EARS basic patterns: Ubiquitous, Event-driven, State-driven, Optional Feature, Unwanted Behavior.
- [ ] Đã cân nhắc Complex / Combined EARS Requirements nếu feature có nhiều điều kiện.
- [ ] Mỗi requirement có mã ID rõ ràng.
- [ ] Requirement có thể kiểm thử được.
- [ ] Không mô tả quá sâu implementation.
- [ ] Không tự ý thêm feature ngoài tài liệu nguồn.
- [ ] Không tự ý thêm database table/field mới nếu chưa có căn cứ.
- [ ] Error handling đã bao gồm validation, authentication, authorization, business rule, conflict, integration/device failure nếu liên quan.
- [ ] Error requirements đã ưu tiên format `IF ... THEN THE system SHALL ...`.
- [ ] Acceptance Criteria dùng Given / When / Then.
- [ ] Traceability đã liên kết AC với FR/ERR/NFR liên quan.
- [ ] Out of Scope đủ rõ để tránh agent tự mở rộng.
- [ ] Các phần thiếu thông tin đã được đưa vào `Cần làm rõ`.