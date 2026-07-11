# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Tạo mới research.md cho UC-SM-02, tổng hợp phân tích codebase + tham khảo ngành trước khi viết spec.md | Toàn bộ file |

---

# Research: Suggest Optimal Time Slot (UC-SM-02)

## 1. Codebase Analysis

### Existing Patterns tái sử dụng được

**`SchedulingModule`** (`src/modules/scheduling/`):
- Đã có `SchedulingController`, `SchedulingService` (UC-SM-01 / UC-50 — room suggestion) và `ParticipantConflictService` (UC-SM-04 / UC-53 — participant conflict check).
- Convention: `@InjectEntityManager()` + raw SQL qua `EntityManager.query()`, không dùng Repository pattern trong module này.
- Validation: DTO + `class-validator` + `ValidationPipe({ whitelist, transform, forbidNonWhitelisted })`.
- Auth: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('scheduling.xxx')`.

**`ParticipantConflictService.mergeBusySlots()`**: thuật toán merge-interval một-pass (sort sẵn theo `start_time ASC` từ SQL, sau đó duyệt tuyến tính gộp các khoảng chồng lấn) — đây chính là building block cho `FreeBusyService` mới của UC-SM-02, chỉ cần áp dụng cho nhiều participant × nhiều ngày thay vì 1 khung giờ cố định.

**Đã đặt trước route**: `spec/features/scheduler/feat-scheduling-room-suggestions/spec.md` mục 8.2 liệt kê rõ "Gợi ý thời gian họp tối ưu: UC-51 (`POST /api/v1/scheduling/time-suggestions`)" — xác nhận route và phương thức HTTP đã được team dự tính từ trước, không phải tự đặt.

**Bug phát hiện trong lúc nghiên cứu (không thuộc scope UC-SM-02)**: `ParticipantConflictService.findConflictingUserIds()` / `findBusySlots()` build raw SQL với placeholder bị hỏng (số nguyên trần `1,2,3...` thay vì `$1,$2,$3...`), và `formatWarningMessage()` có chuỗi tiếng Việt bị corrupt. Đã tách thành task riêng (không sửa trong phạm vi UC-SM-02) vì đây là lỗi của UC-SM-04 đã tồn tại từ trước.

### Entity / Column chính xác

| Bảng | Cột dùng | Ghi chú |
|---|---|---|
| `meetings` | `start_time`, `end_time` (timestamptz), `status`, `organizer_id`, `deleted_at` | status enum: draft/pending_approval/scheduled/in_progress/completed/cancelled |
| `meeting_participants` | `meeting_id`, `user_id`, `invitation_status`, `is_required` | `is_required` map thẳng vào khái niệm Required/Optional của UC gốc — không cần schema mới |
| `room_bookings` | `reserved_start_time`, `reserved_end_time` | **Không dùng** trong UC-SM-02 — chỉ liên quan phòng (UC-SM-01), UC-SM-02 chỉ quan tâm lịch người |

### Không tồn tại (net-new cho UC-SM-02)

Không có `FreeBusyService`, `AvailabilityService`, hay bất kỳ logic multi-slot ranking nào trong codebase hiện tại. Toàn bộ thuật toán search + rank slot là phần việc mới.

## 2. Tham khảo thực tế ngành

| Sản phẩm | Cách tiếp cận | Áp dụng gì vào UC-SM-02 |
|---|---|---|
| **Google Calendar "Find a time"** | Lưới free/busy theo người; không chỉ tìm slot đầu tiên mà còn tìm phương án dự phòng khi không có slot hoàn hảo | Mô hình gần nhất — UC-SM-02 cũng trả nhiều slot xếp hạng, có "best" và "next best" (qua matchScore) thay vì chỉ 1 kết quả |
| **Microsoft Outlook AutoPick** | Chọn slot **sớm nhất** thoả required attendees, chỉ trả 1 kết quả | Đơn giản hơn UC-SM-02 (không multi-ranking) — không áp dụng, nhưng logic "required phải rảnh 100%" của AutoPick khớp với Quyết định D3 (Required = hard filter) |
| **Doodle** | Mô hình bỏ phiếu thủ công (yes/no/if-need-be), không tự đọc lịch hệ thống | Không áp dụng — UC-SM-02 yêu cầu tự động đọc lịch nội bộ, không hỏi ý kiến |
| **Thuật toán chuẩn ngành (interval scheduling)** | Gom toàn bộ busy-interval → sort theo start → merge overlap một-pass O(n log n) → phần bù (gap) là free chung | Base algorithm cho `FreeBusyService`: tính free-interval của từng Required participant, intersect toàn bộ Required (interval intersection theo kiểu sweep), sau đó lọc gap >= durationMinutes |

## 3. Quyết định kỹ thuật (Technology Decisions)

| Decision | Chọn | Lý do |
|---|---|---|
| Thuật toán tìm slot | Merge-interval + intersection theo Required group, sau đó chấm điểm Optional | O(n log n) thay vì lặp N slot rời rạc gọi `ParticipantConflictService` N lần — hiệu quả hơn với search range nhiều ngày |
| Required participant | Hard filter (phải 100% rảnh mới được đề xuất) | Khớp cách diễn giải "trọng số cao nhất / must-have" của BR2 UC gốc, đồng thời cho kết quả dễ kiểm thử/dự đoán hơn là weighted-score mờ |
| Optional participant | Chỉ ảnh hưởng ranking (matchScore), không loại slot | Đúng nguyên văn BR2: "chỉ được hệ thống dùng làm tiêu chí phụ để so sánh và xếp hạng" |
| Trạng thái meeting tính bận | `scheduled`, `in_progress` | Nhất quán với UC-SM-04 đã implement (không tính `pending_approval` là bận cứng, tránh optimize quá mức khiến slot bị loại oan vì 1 request chưa duyệt) |
| Organizer | Required ngầm định | Không UC nào của tổ chức lại đề xuất giờ mà chính người tổ chức bận — pattern chuẩn của Google/Outlook cũng luôn coi organizer là required |
| Endpoint | `POST /api/v1/scheduling/time-suggestions` | Đã được UC-SM-01 spec đặt trước (mục 8.2), tránh đặt tên khác gây trùng lặp route |
| Ghép với room suggestion | Không ghép — API riêng | Giữ single responsibility, đúng Trigger/Description UC gốc chỉ nói về "khoảng thời gian", không đề cập phòng |

## 4. Risks

- **Performance với search range rộng + nhiều participant**: giới hạn 30 ngày × 50 participants (NFR-001/002) để tránh quét quá nặng; nếu cần mở rộng hơn, cân nhắc caching busy-interval theo participant trong request.
- **Privacy**: response tuyệt đối không lộ title/description/roomId của meeting người khác — chỉ `busyFrom/busyTo` (đã ràng buộc ở FR-030, NFR-005, AC-015).
- **Độ chính xác khi không có timezone/business-hours filter**: v1 có thể đề xuất slot lúc 23h nếu đúng là mọi người rảnh — chấp nhận được cho v1, ghi rõ trong Out of Scope, không tự ý thêm filter chưa được yêu cầu (đúng nguyên tắc CLAUDE.md "không tự ý mở rộng scope").
