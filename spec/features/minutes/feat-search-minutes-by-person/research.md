# Research: Search Meeting Minutes by Person (UC-MKM-07)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo research, ghi lại quá trình phân tích code + Q&A đã chốt với Product Owner | Toàn bộ file |

## 1. Câu hỏi ban đầu: UC-MKM-07 có trùng `feat-list-meeting-minutes` không?

**Không.** Khác với UC-MKM-06 (hóa ra trùng hoàn toàn với filter `from`/`to` đã có), UC-MKM-07 khác biệt về bản chất:
- UC-MKM-02 (`feat-list-meeting-minutes`): actor tự xem biên bản liên quan tới **chính mình** (scope dựa trên `currentUser`).
- UC-MKM-07: Manager/Admin tra cứu biên bản liên quan tới **1 nhân sự khác** (`userId` là tham số tra cứu, không phải actor). Đây là bài toán phân quyền hoàn toàn khác — cần feature backend mới.

## 2. Đối chiếu code thật (research trước khi Q&A) — kết quả agent đã xác nhận

| Câu hỏi | Kết quả xác nhận qua code |
| :--- | :--- |
| Đã có endpoint autocomplete tìm nhân sự chưa? | **Có** — `GET /api/v1/users` (`src/modules/accounts/controllers/users.controller.ts`), permission `accounts.user.list`, hỗ trợ tìm theo tên/email, trả `id/fullName/email`. Feature này tái sử dụng, không xây lại. |
| `meetings` có cột `department_id` không? | **Không.** Chỉ có thể suy luận gián tiếp qua `hostId`/`organizerId` → `users.departmentId`. |
| Có sẵn pattern "Manager scope" nào trong code chưa? | **Có, nhưng khác model**: `AttendanceService.checkAccess`/`getDirectReportIds` (`src/modules/attendance/services/attendance.service.ts`) dùng `users.direct_manager_id` (quản lý trực tiếp, 1 cấp, theo từng participant của 1 cuộc họp cụ thể) — KHÔNG dùng `departments.manager_user_id`/`parent_department_id`. Đây là 2 khái niệm "quản lý" song song, chưa từng thống nhất. |
| `MinutesQueryDto` đã có filter `userId` chưa? | **Chưa** — chỉ có `q` (free-text). |
| Department hierarchy fields | `departments.managerUserId`, `departments.parentDepartmentId`, `users.departmentId`, `users.directManagerId` (khác `departments.managerUserId`) — đã xác nhận đủ field cần dùng. |

## 3. Q&A đã chốt với Product Owner

| # | Câu hỏi | Quyết định cuối cùng |
| :--- | :--- | :--- |
| 1 | Model phân quyền Manager: theo `departments.manager_user_id` (đúng nghĩa đen UC) hay tái dùng `direct_manager_id` của attendance? | **`departments.manager_user_id`** — đúng nghĩa đen "phòng ban do Manager phụ trách" của BR1 UC gốc. KHÔNG dùng pattern attendance (khác ngữ nghĩa: đó là "quản lý trực tiếp nhân sự", không phải "phụ trách phòng ban"). |
| 2 | Suy luận phòng ban của cuộc họp từ đâu? | `meeting.host.departmentId`; nếu `hostId IS NULL` → fallback `meeting.organizer.departmentId` (vì `organizerId` luôn bắt buộc). |
| 3 | Có đệ quy phòng ban con (`parent_department_id`) không? | **Không** — giữ đơn giản (MVP), có thể mở rộng sau. |
| 4 | "Nhân sự liên quan" = ai? | `participant` (qua `meeting_participants`) HOẶC `prepared_by` của chính biên bản — theo đúng gợi ý UC-135 trong API_CONTRACT. |
| 5 | Biên bản `draft` có hiển thị cho Manager không? | **Không** — chỉ `published`/`archived`. Business/System Admin vẫn thấy `draft` (nhất quán quyền admin đã có ở `feat-list-meeting-minutes`). |
| 6 | Thiết kế endpoint: thêm param vào `GET /meeting-minutes` hay tách riêng? | **Tách riêng** `GET /meeting-minutes/search-by-person` — vì 2 mô hình phân quyền khác biệt hoàn toàn, gộp chung dễ gây lỗi rò rỉ quyền và khó test/review. |
| 7 | Permission mới có cấp cho `INTERNAL_USER` không (như các permission `minutes.*` khác)? | **Không** — chỉ cấp `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`, đúng theo Primary Actor của UC gốc (không có Internal Employee thường). |
| 8 | System Admin có ngang Business Admin không? | Có — nhất quán RBAC toàn module `minutes`. |
| 9 | EX1 (không tìm thấy nhân sự) xử lý ở BE thế nào? | Validate `userId` tồn tại + chưa xóa mềm → `404 USER_NOT_FOUND`. |
| — | Manager tra cứu ngoài phạm vi phòng ban → lỗi hay rỗng? | **Rỗng** (`200`, `data=[]`), không phải lỗi 403 — tự nhiên từ điều kiện WHERE, không cần code chặn riêng. |

## 4. Vì sao KHÔNG dùng lại pattern `direct_manager_id` của `attendance`?

Đọc kỹ `AttendanceService.checkAccess`/`getDirectReportIds`: logic này trả lời câu hỏi "Manager có phải là quản lý trực tiếp (`users.direct_manager_id`) của ít nhất 1 participant trong CHÍNH cuộc họp này không?" — tức là scope theo **quan hệ cá nhân với từng participant**, tính lại cho từng cuộc họp riêng lẻ.

UC-MKM-07 lại hỏi khác: "Cuộc họp này có thuộc phạm vi phòng ban mà Manager phụ trách không?" — tức là scope theo **đơn vị tổ chức (department)**, không phụ thuộc quan hệ cá nhân với từng participant. Một Manager có thể phụ trách phòng ban A (qua `departments.manager_user_id`) nhưng không phải `direct_manager_id` của bất kỳ ai trong phòng ban đó (ví dụ nhân sự mới, hoặc cơ cấu quản lý gián tiếp qua nhiều cấp) — 2 model cho kết quả khác nhau trên cùng 1 dữ liệu thực tế.

Vì UC-MKM-07 dùng đúng từ "phòng ban do Manager phụ trách", quyết định bám sát nghĩa đen này (`departments.manager_user_id`) thay vì tái dùng pattern có sẵn nhưng sai ngữ nghĩa.

**Ghi chú để lại cho tương lai** (đã đưa vào spec.md mục 8.2): hệ thống hiện có 2 khái niệm "quản lý" độc lập (`users.direct_manager_id` và `departments.manager_user_id`) phục vụ 2 mục đích khác nhau. Nếu sau này Product Owner muốn hợp nhất thành 1 khái niệm chung, cần 1 quyết định thiết kế riêng, ngoài phạm vi feature này.

## 5. Có cần bảng/cột mới không?
**Không.** Toàn bộ field cần dùng (`departments.managerUserId/isActive/deletedAt`, `users.departmentId`, `meetings.hostId/organizerId`, `meeting_participants.userId`, `meeting_minutes.preparedBy/status`) đã có sẵn trong baseline. Chỉ thêm 1 permission mới (migration).

## 6. Rủi ro & quyết định thiết kế
| Rủi ro | Quyết định |
| :--- | :--- |
| Route `search-by-person` (static) xung đột thứ tự với route `:id` (dynamic) nếu UC-MKM-03 được code sau | Ghi chú rõ trong plan.md mục 2.2/12: route static phải khai báo trước route dynamic trong cùng controller |
| `findMinutesList` hiện tại không JOIN `organizer`, cần thêm JOIN mới cho feature này | Ghi rõ trong plan.md mục 7.1, không sửa `findMinutesList` (giữ nguyên, chỉ thêm method mới độc lập) |
| Nhầm lẫn 2 model "quản lý" (`direct_manager_id` vs `departments.manager_user_id`) khi code | Đặt tên biến/method rõ ràng (`managedDepartmentIds`, không dùng tên gợi nhớ tới `AttendanceService`) |
| Permission mới bị copy-paste cấp nhầm cho `INTERNAL_USER` | Unit test AC-007 xác nhận `INTERNAL_USER` nhận 403 |

## 7. Kết luận
Không có unknown nào chặn việc viết plan.md/tasks.md. Toàn bộ quyết định đã được Product Owner xác nhận trực tiếp qua Q&A, không còn `[NEEDS CLARIFICATION]` nào mở trong spec.md.
