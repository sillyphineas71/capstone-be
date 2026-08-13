# Đánh giá SRS — Notification and Reporting

## Tổng quan

Số UC: 2 | Khớp hoàn toàn: 0 | Khớp 1 phần: 1 | Sai hoàn toàn: 1 | Không có code: 0

---

## UC-94 — Gửi Thông báo Vòng đời Cuộc họp (Mời/Nhắc/Hủy)

**Trạng thái:** ❌ SAI HOÀN TOÀN

**SRS hiện tại ghi:** Primary Actor: **System**. Toàn bộ 3 nhánh (Mời/Nhắc/Hủy) là **"một cơ chế thông báo email tự động DUY NHẤT"** (BR-25: "Tất cả các thông báo email vòng đời cuộc họp tuân theo CÙNG một cơ chế biên soạn và phân phối"). Trigger tự động: "Hệ thống phát hiện cuộc họp chuyển sang 'Đã lên lịch'" (mời); "Hệ thống liên tục quét giờ bắt đầu... phát hiện khớp độ lệch nhắc nhở đã cấu hình" (nhắc nhở); "Hệ thống phát hiện cuộc họp chuyển sang 'Đã hủy'" (hủy).

**Code thực tế (bằng chứng):** Kiểm tra tách riêng từng nhánh cho thấy **3 trạng thái triển khai hoàn toàn khác nhau** — không hề là "cùng một cơ chế tự động duy nhất" như SRS khẳng định:

1. **Nhắc nhở (Reminder) — HOÀN TOÀN CHƯA IMPLEMENT (chỉ là TODO stub):**
   `src/modules/scheduler/scheduler.service.ts:598-612`:
   ```ts
   /**
    * Meeting reminder notification job.
    * Cron: SCHEDULER_NOTIFICATION_REMINDER_CRON (default: every hour)
    * TODO: Gọi NotificationsService.sendScheduledReminders() khi implement.
    */
   @Cron(CronExpression.EVERY_HOUR, { name: 'notification-reminder' })
   async sendReminders(): Promise<void> {
     if (!this.schedulerEnabled || !this.reminderEnabled) return;
     this.logger.log(
       '[Scheduler] sendReminders() triggered — TODO: implement reminder notification logic.',
     );
     // TODO: inject NotificationsService và gọi sendScheduledReminders()
   }
   ```
   Cron chạy mỗi giờ nhưng **chỉ log ra 1 dòng rồi kết thúc, không gửi bất kỳ thông báo nào**. Grep `sendScheduledReminders` toàn repo: **chỉ xuất hiện trong 2 dòng comment/TODO của chính file này** — hàm này chưa từng được viết. Cơ chế nhắc nhở tự động **không tồn tại**.

2. **Mời (Invite) — trigger chính "meeting chuyển sang Đã lên lịch" KHÔNG tự động gửi:**
   Grep `NotificationsService|createNotification|enqueueEmail` trong toàn bộ `src/modules/approvals/` (module xử lý phê duyệt `meeting_requests` → xác nhận meeting, đây chính là thời điểm meeting "chuyển sang Đã lên lịch" theo kiến trúc thật — xem Mục 3 UC-20/UC-24): **0 kết quả**. Không có bất kỳ notification/email nào được gửi khi một meeting request được duyệt và meeting chính thức được xác nhận. Thay vào đó chỉ có 1 route **thủ công**: `POST meetings/:meetingId/invitations` (permission `notification.invite.send`, `src/modules/notifications/notifications.controller.ts:56-70`) — Host/Admin phải chủ động bấm gửi, chọn kênh (`in_app`/`email`) qua `SendMeetingInvitationDto.channels` (`meeting-notifications.service.ts:103-192`).
   Tự động chỉ tồn tại cho các sự kiện **phái sinh sau đó**: thêm participant mới vào meeting đã tồn tại (`meetings.service.ts:3486-3525`, IN_APP + EMAIL, khớp AF-1 của SRS), hoặc thêm external participant (`meetings.service.ts:4523-4540`, chỉ EMAIL).

3. **Hủy (Cancellation) — CÓ tự động, khớp SRS khá tốt:**
   `cancelMeeting()` (`meetings.service.ts:2955-3030+`) tự động gửi IN_APP (dòng 2989-3001) và EMAIL (dòng 3003-3030+) cho toàn bộ participant + external participant ngay khi meeting bị hủy — không cần thao tác thủ công riêng. BR-02 (dòng lý do bị lược bỏ nếu trống) khớp chính xác: `notificationReasonStr = cancellationReason ? ' Lý do: ...' : ''` (dòng 2979-2981).

**Nhận xét:**
Bản thân tiền đề trung tâm của UC-94 — "một cơ chế System tự động DUY NHẤT cho cả 3 sự kiện, cùng một cách biên soạn/phân phối (BR-25)" — bị chính thực tế code bác bỏ: 3 nhánh nằm ở **3 trạng thái hoàn toàn khác nhau** (Nhắc nhở: không tồn tại/TODO; Mời tại đúng thời điểm "đã lên lịch": không tự động, chỉ có nút thủ công; Hủy: tự động, khớp tốt). Đây không phải một vài chi tiết sai lệch nhỏ mà là sự sụp đổ của chính luận điểm hợp nhất mà UC-94 dùng để biện minh cho việc gộp 3 UC cũ làm một.

**Đề xuất sửa SRS:**
> Tách lại thành thực trạng thật của 3 luồng, vì chúng KHÔNG dùng chung một cơ chế:
> - **Hủy** (tự động, System-triggered): khi `cancelMeeting()` chạy, hệ thống tự động gửi in-app + email cho toàn bộ participant/external participant, dòng "Lý do hủy" tự lược bỏ nếu trống.
> - **Mời** (thủ công): Host/Admin phải chủ động gọi `POST /meetings/:meetingId/invitations` chọn kênh gửi. Việc phê duyệt meeting request (chuyển sang "đã lên lịch") **không** tự động gửi lời mời. Chỉ có 2 trường hợp tự động thật: thêm participant nội bộ mới (in-app + email) và thêm participant ngoài công ty (chỉ email).
> - **Nhắc nhở**: **chưa được triển khai** — có sẵn 1 cron job chạy mỗi giờ (`SCHEDULER_NOTIFICATION_REMINDER_CRON`) nhưng thân hàm chỉ log, không gửi gì; có route thủ công thay thế `POST /meetings/:meetingId/reminders` để Host tự bấm gửi nhắc nhở khi cần.

---

## UC-95 — Gửi Cảnh báo Vận hành (No-show/Khuôn mặt Lạ/Chưa Check-in/Xung đột Gia hạn)

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** 5 trigger từ 4 module khác nhau (no-show, khuôn mặt lạ, chưa check-in, lên lịch cảnh báo thời gian còn lại, kích hoạt cảnh báo) đều định tuyến qua **cùng một dịch vụ gửi cảnh báo trung tâm**. BR-03: khi phát hiện xung đột lịch đặt tiếp theo, hệ thống phải **khóa trực tiếp** chức năng gia hạn trên giao diện Host.

**Code thực tế (bằng chứng):**
- Cảnh báo no-show: `no-show-lifecycle.service.ts:380-416` gọi trực tiếp `NotificationsService.createNotification()` (IN_APP) và `enqueueEmailNotification()` (EMAIL) với `notificationType: NO_SHOW_ALERT` — đúng là cùng dùng chung hạ tầng `NotificationsService`/`MailService` như các module khác (Mục 7, 9, 13, 14 đều quy về cùng 1 service này) — khớp tinh thần "định tuyến qua cùng một dịch vụ".
- Cảnh báo thời gian còn lại (remaining-time warning): hệ thống riêng khá hoàn chỉnh gồm `meeting-warning.service.ts` + `meeting-warning.processor.ts` (BullMQ job, đúng khái niệm "Timer/Schedule Job" của SRS), đọc buffer cấu hình từ `system_configs['meeting_warning_conflict_buffer_minutes']` (dòng 57-63), và có 2 nhánh **standard** (branch A) và **conflict/leo thang** (branch B, dòng 181-183, 261, 300+) — khớp đúng ý "Cảnh báo Chuẩn" vs "Cảnh báo Nghiêm ngặt/Leo thang" của SRS.
- BR-03 (khóa chức năng gia hạn khi có xung đột): theo phát hiện đã ghi nhận ở **Mục 8 (In-Meeting Management, UC-51/52)**, kiến trúc thật của gia hạn (extension) là: nhánh không xung đột được áp dụng **inline ngay trong chính request**; nhánh CÓ xung đột **không đơn thuần khóa nút** trên UI mà tạo ra một **yêu cầu PENDING đòi hỏi quyết định thật của con người** (Manager/Admin) qua endpoint `/decide` riêng — khác với hình dung "khóa trực tiếp chức năng gia hạn" của SRS (ngụ ý Host hoàn toàn không gửi được yêu cầu), thực tế Host vẫn gửi được yêu cầu nhưng nó không tự động được duyệt.

**Nhận xét:**
Về tổng thể, cơ chế cảnh báo vận hành khớp khá tốt với SRS ở tầng hạ tầng dùng chung (`NotificationsService`) và ở luồng "lên lịch + leo thang cảnh báo thời gian còn lại" (rất chi tiết, đúng tinh thần). Điểm lệch cụ thể duy nhất đã xác nhận được là BR-03: hành vi thật khi có xung đột là **chuyển sang chờ duyệt thủ công (pending approval)**, không phải **khóa cứng** chức năng gia hạn trên giao diện như SRS mô tả.

**Đề xuất sửa SRS:**
> BR-03: Khi phát hiện xung đột lịch đặt phòng tiếp theo, hệ thống **không khóa** nút gia hạn — Host vẫn có thể gửi yêu cầu gia hạn, nhưng yêu cầu đó chuyển sang trạng thái **chờ duyệt (pending)** và cần Manager/Admin quyết định thủ công qua một hành động riêng, thay vì được tự động áp dụng ngay như trường hợp không xung đột (xem thêm Mục 8, UC-51/52).

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **`MeetingNotificationsService` — bộ công cụ gửi/gửi-lại thủ công cho toàn bộ vòng đời** (`sendMeetingInvitation`, `sendMeetingReminder`, `resendCancellationNotification`, `distributeMeetingMinutes` — gắn nhãn nội bộ UC-143→146) — một lớp API hoàn chỉnh cho phép Host/Admin **chủ động** gửi lại bất kỳ loại thông báo vòng đời nào, chọn kênh gửi (`in_app`/`email`) tùy ý — hoàn toàn không có trong SRS, và thực chất đang gánh vác phần lớn vai trò mà SRS gán cho "System tự động".
2. **Hộp thư thông báo cá nhân (Notification Inbox)** — `GET /notifications`, `GET /notifications/:id`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` (`notifications.controller.ts:138-188`, gắn nhãn "UC-NOTI-01/02/03") — một hệ thống inbox/đã đọc hoàn chỉnh cho người dùng cuối, không được SRS Mục 14 nhắc tới (SRS chỉ mô tả việc HỆ THỐNG gửi đi, không mô tả trải nghiệm người nhận xem/quản lý thông báo).
3. **Hạ tầng gửi email thật có hàng đợi + đính kèm file** (`NotificationWorkerService`, BullMQ queue `notification`, hỗ trợ `attachment` tải từ Storage ngay trước khi gửi — `notification-worker.service.ts:23-133`) — dùng chung cho mọi luồng email trong toàn hệ thống (không riêng module này) — SRS chỉ nói "Email Service" như một hộp đen, không mô tả cơ chế hàng đợi/retry/đính kèm.
