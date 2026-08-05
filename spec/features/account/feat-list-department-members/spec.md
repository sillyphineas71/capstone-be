# Feature Specification: Xem danh sách nhân viên theo phòng ban (phục vụ import nhanh vào cuộc họp)

- **Feature ID**: ACCT-DEPT-MEMBERS-001
- **Feature Name**: List Department Members (hỗ trợ tính năng FE "Nhập nhanh cả phòng ban vào danh sách người tham dự")
- **Module / Domain**: accounts
- **Created Date**: 2026-08-05
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu trực tiếp của Thiếu Chủ (2026-08-05): booking meeting cần chọn 1 phòng ban → tự động nạp toàn bộ nhân viên phòng đó vào danh sách người tham dự, kèm thông tin đầy đủ + vị trí trong phòng ban để dễ phân biệt.
  - `meeting-booking-api-flow.md` (luồng `POST /api/v1/meetings`, field `participantUserIds`)
  - `capstone-be/src/modules/scheduling/scheduling.controller.ts` (endpoint kiểm tra xung đột lịch đã có sẵn — tái sử dụng, không viết lại)
  - Database v3.2 Compact (39 Tables) — bảng `departments`, `users`
  - CLAUDE.md / AGENTS.md (Backend Agent Guide v1.1)

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-05 | Khởi tạo spec — chốt scope tối thiểu sau khi đối chiếu schema thật và các API đã có sẵn (`GET /users`, `POST /scheduling/participant-conflicts/check`). Quyết định: KHÔNG đổi `CreateMeetingDto`/`meetings.service.ts`, KHÔNG thêm permission mới, KHÔNG tự tính conflict lịch trong endpoint này. | Toàn bộ file |

---

## 1. Context & Goal

### 1.1 Bối cảnh
Khi đặt lịch họp, người tổ chức phải tìm và chọn từng người tham dự một qua ô tìm kiếm (`GET /users`, dùng cho `participantUserIds` trong `POST /api/v1/meetings`). Với cuộc họp toàn phòng ban (họp team, đào tạo nội bộ, review phòng ban), việc gõ tìm từng người rất mất thời gian và dễ sót người.

### 1.2 Mục tiêu
Cho phép người dùng **chọn 1 phòng ban** trên màn hình đặt lịch, hệ thống trả về **toàn bộ nhân viên đang hoạt động** trực thuộc phòng ban đó, kèm đầy đủ thông tin liên hệ và **vị trí công việc (`positionTitle`)** để người dùng dễ phân biệt/rà soát trước khi bỏ bớt vài người rồi mới xác nhận thêm vào danh sách tham dự.

### 1.3 Giá trị mang lại
- **Hiệu suất**: nạp hàng chục người trong 1 lần chọn thay vì tìm từng người.
- **Chính xác**: có `positionTitle` + đánh dấu trưởng phòng (`isDepartmentManager`) giúp người đặt lịch nhận diện đúng người, giảm nhầm lẫn khi phòng ban đông người trùng tên.
- **Không phá vỡ luồng hiện có**: tận dụng nguyên xi cơ chế `participantUserIds` sẵn có trong `POST /api/v1/meetings` — không đổi API tạo cuộc họp.

### 1.4 Giả định
- FE đã có UI chọn người tham dự dạng danh sách chọn được (checkbox/multi-select) submit qua `participantUserIds`.
- FE tự chịu trách nhiệm hợp nhất (merge + dedupe) danh sách trả về từ endpoint này vào danh sách người tham dự đang chọn trước khi gọi `POST /api/v1/meetings`.
- Việc kiểm tra xung đột lịch cho những người vừa nạp **dùng lại** endpoint đã có sẵn `POST /api/v1/scheduling/participant-conflicts/check` (xem mục 1.5) — không xây mới trong feature này.

### 1.5 Quyết định thiết kế quan trọng (đã đối chiếu code thật trước khi chốt)
Ba quyết định sau đây làm giảm đáng kể phạm vi so với đề xuất ban đầu, lý do nêu rõ để review không thắc mắc lại:

1. **Không sửa `CreateMeetingDto` / `meetings.service.ts`.** `POST /api/v1/meetings` đã nhận `participantUserIds: string[]` và tự validate/dedupe/check-capacity/check-conflict trên mảng đó (`meetings.service.ts:570-646`). FE chỉ cần gộp kết quả của endpoint này vào mảng đó trước khi submit — không có lý do kỹ thuật nào để BE phải "biết" khái niệm import-theo-phòng-ban ở bước tạo cuộc họp.
2. **Không tự tính cờ xung đột lịch (`scheduleConflict`) trong endpoint này.** Hệ thống đã có sẵn `POST /api/v1/scheduling/participant-conflicts/check` (`scheduling.controller.ts:91`, permission `scheduling.conflict.participant.check`) nhận `participantUserIds[]` + `startTime`/`endTime`, trả về trạng thái free/busy/unknown từng người. Viết lại logic này trong module `accounts` sẽ trùng lặp và có nguy cơ lệch kết quả với luồng tạo cuộc họp thật (vốn cũng gọi `checkParticipantConflicts` y hệt). FE gọi 2 API tuần tự: endpoint này lấy danh sách, rồi endpoint scheduling để lấy cảnh báo trùng lịch.
   - Lưu ý cho FE: `participantUserIds` của endpoint scheduling giới hạn tối đa **50 phần tử/lần gọi** (`ArrayMaxSize(50)`). Nếu phòng ban có hơn 50 người, FE cần chia nhỏ thành nhiều lần gọi.
3. **Không thêm permission mới.** Endpoint này lộ thông tin liên hệ cá nhân (email/số điện thoại) của người dùng nội bộ — cùng loại rủi ro với endpoint tìm người tham dự đã có (`GET /users`, permission `accounts.user.list`, dùng để autocomplete chọn `participantUserIds`). Tái dùng đúng permission `accounts.user.list` — cùng ranh giới tin cậy, không cần seed migration mới.

---

## 2. Actor & Roles

### 2.1 Danh sách actor
| Actor | Vai trò | Quyền |
|---|---|---|
| Bất kỳ user đã đăng nhập có quyền `accounts.user.list` | Người đặt lịch họp, đang chọn người tham dự | Xem danh sách nhân viên trực thuộc trực tiếp 1 phòng ban bất kỳ trong hệ thống |

### 2.2 Role & Permission Rules
- Yêu cầu permission **`accounts.user.list`** (đã tồn tại, đã gán cho các role hiện đang tạo được cuộc họp — xem seed hiện có, không cần thay đổi).
- Không giới hạn theo phòng ban của actor (giống hành vi hiện tại của `GET /users` — tìm người tham dự không giới hạn phạm vi phòng ban của người tìm).

### 2.3 Actor Constraints
- Actor đã đăng nhập (`JwtAuthGuard`) và có permission ở trên (`PermissionsGuard`).

---

## 2.4 User Scenarios & Workflow

### 2.4.1 Preconditions
- PRE-1: Actor đã đăng nhập, có permission `accounts.user.list`.
- PRE-2: `departmentId` tồn tại trong bảng `departments` và chưa bị soft-delete.

### 2.4.2 Postconditions
- POST-1: Endpoint chỉ **đọc** dữ liệu — không ghi/thay đổi bất kỳ bảng nào.

### 2.4.3 Normal Flow
1. Actor ở màn hình đặt lịch, mở phần chọn "Nhập theo phòng ban", chọn 1 phòng ban.
2. FE gọi `GET /api/v1/departments/:departmentId/members`.
3. Hệ thống trả về danh sách nhân viên **trực thuộc trực tiếp** phòng ban đó, đang **`employment_status` ∈ {active, probation}** và **`account_status = active`**, sắp xếp trưởng phòng lên đầu rồi theo tên.
4. FE hiển thị danh sách (tên, email, `positionTitle`, đánh dấu trưởng phòng) cho actor xem trước, actor có thể bỏ chọn vài người.
5. Actor xác nhận → FE gộp các `userId` còn lại vào mảng `participantUserIds` đang chọn trên form đặt lịch (dedupe với người đã chọn thủ công trước đó).
6. (Tuỳ chọn) FE gọi `POST /api/v1/scheduling/participant-conflicts/check` với danh sách vừa nạp + khung giờ đã chọn để hiển thị cảnh báo trùng lịch trước khi submit.
7. Actor submit `POST /api/v1/meetings` như luồng hiện tại — không có thay đổi gì ở bước này.

### 2.4.4 Exceptions
- **EX1**: `departmentId` không tồn tại hoặc đã bị soft-delete → `404 DEPARTMENT_NOT_FOUND`.
- **EX2**: Phòng ban tồn tại nhưng không có nhân viên nào thoả điều kiện lọc (phòng mới lập, hoặc toàn bộ đã nghỉ việc) → `200` với `data: []`, **không phải lỗi**.

---

## 3. Functional Requirements

- **FR-001**: THE system SHALL cung cấp endpoint `GET /api/v1/departments/:departmentId/members` trả về danh sách nhân viên trực thuộc **trực tiếp** phòng ban (`users.department_id = :departmentId`), không đệ quy phòng ban con.
- **FR-002**: THE system SHALL chỉ trả về user có `employment_status` ∈ {`active`, `probation`}, `account_status = 'active'`, và `deleted_at IS NULL`.
- **FR-003**: IF `departmentId` không tồn tại hoặc `departments.deleted_at IS NOT NULL`, THE system SHALL trả `404 DEPARTMENT_NOT_FOUND`.
- **FR-004**: THE system SHALL KHÔNG chặn theo `departments.is_active` — phòng ban inactive vẫn cho xem danh sách thành viên hiện có (đồng nhất hành vi đọc với `GET /departments`, vốn cũng không lọc theo `is_active`).
- **FR-005**: FOR EACH nhân viên trả về, THE system SHALL đính kèm `isDepartmentManager = true` NẾU `userId` trùng `departments.manager_user_id` của phòng ban đang truy vấn.
- **FR-006**: THE system SHALL sắp xếp kết quả: `isDepartmentManager` giảm dần trước, sau đó `fullName` tăng dần.
- **FR-007**: THE system SHALL trả về toàn bộ danh sách trong **một response, không phân trang** (phù hợp UX "chọn cả phòng ban" — phân trang sẽ phá vỡ thao tác chọn tất cả).
- **FR-008**: THE system SHALL KHÔNG tính hoặc trả trường xung đột lịch — việc này thuộc trách nhiệm của `POST /api/v1/scheduling/participant-conflicts/check` đã có sẵn (xem mục 1.5).

---

## 4. Non-functional Requirements
- **NFR-001**: THE system SHALL phản hồi dưới 1 giây cho phòng ban ≤ 500 nhân viên trong điều kiện bình thường (1 query có index trên `users.department_id`).
- **NFR-002**: THE system SHALL KHÔNG trả `password_hash` hoặc bất kỳ field nhạy cảm nào ngoài các field liệt kê ở mục 7.2 (dùng `select` tường minh, không trả cả entity).

---

## 5. Data Model

### 5.1 Entity liên quan
| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `departments` | Xác định phòng ban tồn tại + `manager_user_id` | READ |
| `users` | Nguồn danh sách nhân viên | READ (`department_id`, `employment_status`, `account_status`, `deleted_at`) |

### 5.2 Business Rules Impact
- **KHÔNG thay đổi schema.** Mọi field cần dùng (`users.department_id`, `users.position_title`, `departments.manager_user_id`) đã tồn tại trong v3.2 Compact.
- **KHÔNG thêm bảng, KHÔNG thêm cột, KHÔNG thêm permission, KHÔNG thêm migration.**

---

## 6. Error Handling & Validation Rules

| Case | HTTP | Mã lỗi |
|---|---|---|
| `departmentId` không phải UUID hợp lệ | 400 | `VALIDATION_ERROR` (chuẩn `ParseUUIDPipe`) |
| Phòng ban không tồn tại / đã xoá mềm | 404 | `DEPARTMENT_NOT_FOUND` |
| Thiếu permission `accounts.user.list` | 403 | `FORBIDDEN` (chuẩn `PermissionsGuard`) |

---

## 7. API Contract (Proposed)

### 7.1 Endpoint
```
GET /api/v1/departments/:departmentId/members
Auth: Bearer JWT (JwtAuthGuard + PermissionsGuard, permission accounts.user.list)
```

### 7.2 Response 200
```json
{
  "success": true,
  "message": "Lấy danh sách nhân viên phòng ban thành công",
  "data": [
    {
      "id": "uuid",
      "employeeCode": "EMP0123",
      "fullName": "Nguyễn Văn A",
      "email": "a@company.com",
      "phoneNumber": "0900000000",
      "avatarUrl": null,
      "positionTitle": "Trưởng phòng Kỹ thuật",
      "employmentStatus": "active",
      "isDepartmentManager": true
    },
    {
      "id": "uuid",
      "employeeCode": "EMP0456",
      "fullName": "Trần Thị B",
      "email": "b@company.com",
      "phoneNumber": null,
      "avatarUrl": null,
      "positionTitle": "Senior Backend Engineer",
      "employmentStatus": "probation",
      "isDepartmentManager": false
    }
  ]
}
```

### 7.3 Response 404
```json
{
  "success": false,
  "message": "Không tìm thấy phòng ban",
  "error": { "code": "DEPARTMENT_NOT_FOUND", "details": { "departmentId": "uuid" } }
}
```

---

## 8. Acceptance Criteria

- **AC-001**: Given phòng ban có 10 nhân viên active/probation, khi gọi endpoint, trả về đúng 10 phần tử.
- **AC-002**: Given phòng ban có nhân viên `resigned` hoặc `account_status=inactive/locked`, những người đó KHÔNG xuất hiện trong kết quả.
- **AC-003**: Given phòng ban có nhân viên thuộc phòng ban **con** (khác `department_id`), người đó KHÔNG xuất hiện trong kết quả (không đệ quy).
- **AC-004**: Given `departments.manager_user_id` trỏ tới 1 nhân viên trong danh sách, phần tử đó có `isDepartmentManager=true` và đứng đầu danh sách.
- **AC-005**: Given `departmentId` không tồn tại, trả `404 DEPARTMENT_NOT_FOUND`.
- **AC-006**: Given phòng ban tồn tại nhưng 0 nhân viên hợp lệ, trả `200` với `data: []`.
- **AC-007**: Given actor không có permission `accounts.user.list`, trả `403`.
- **AC-008**: Response không chứa `passwordHash` hay bất kỳ field nào ngoài danh sách ở mục 7.2.

---

## 9. Out of Scope
- Đệ quy lấy nhân viên của phòng ban con (`includeSubDepartments`) — có thể bổ sung sau nếu team yêu cầu, thiết kế endpoint không chặn việc mở rộng này (thêm query param optional).
- Tính/trả cờ xung đột lịch trong endpoint này (dùng `POST /scheduling/participant-conflicts/check` sẵn có).
- Sửa `CreateMeetingDto`, `meetings.service.ts`, hoặc bất kỳ hành vi nào của `POST /api/v1/meetings`.
- Phân trang (bounded theo NFR-001; nếu phát sinh phòng ban >500 người trong thực tế, đánh giá lại ở phase sau).
- Cho phép actor chỉ xem phòng ban trong phạm vi quản lý của mình (scope-restriction) — không áp dụng, vì mục tiêu là hỗ trợ chọn người tham dự toàn hệ thống, giống hành vi hiện tại của `GET /users`.

---

## 10. Assumptions
- FE chịu trách nhiệm toàn bộ UX chọn/bỏ chọn, dedupe, và gọi tiếp API scheduling nếu muốn hiển thị cảnh báo trùng lịch.
- Số lượng nhân viên mỗi phòng ban trong phạm vi capstone là nhỏ (vài chục), không cần phân trang.
