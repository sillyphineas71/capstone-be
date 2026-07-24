# UC158 AUDIT — Đối chiếu 158 Use Case ↔ Source Code

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-18 | Tạo mới báo cáo audit READ-ONLY đối chiếu 158 UC (SMRMPTS) với source code nhánh `dev`. | Toàn bộ file |
| 2026-07-18 | Re-audit sau khi dev cập nhật (HEAD 5f353d1): UC-139/140/141/147 chuyển sang DONE; UC-136/146 giữ nguyên. Cập nhật §7.1, §7.2, §7.3 + thêm §7.7. | §7.1, §7.2, §7.3, §7.7 |

---

## 0. Phạm vi & Phương pháp

- **Loại tác vụ**: AUDIT READ-ONLY. Không sửa/tạo/xóa file `src/`; chỉ tạo duy nhất file này.
- **Nguồn đối chiếu**: `Old_UseCase_List_SMRMPTS.md` (158 UC) ↔ toàn bộ repo `d:\capstone-be`, nhánh `dev`, bao gồm working tree chưa commit.
- **Global route prefix**: `api/v1` (`src/main.ts:11`). Các path trong báo cáo là path controller (chưa gắn prefix).
- **Tiêu chuẩn đối chiếu**: cột **Trigger + Expected Output** của UC, không phải tên UC.
- **Artifact hợp lệ**: HTTP route (method+path) / `@Cron` job / queue-event processor / service method được gọi bởi một trong số đó. **Đã đọc thân hàm** để xác nhận hành vi.
- **Artifact KHÔNG hợp lệ làm bằng chứng DONE**: chỉ có entity/DTO/enum/constant/interface, chỉ `.spec.ts`, chỉ tên biến/comment/TODO, chỉ đăng ký `*.module.ts`.
- **Thang đo**: `DONE` / `PARTIAL` / `MISSING` / `NOT-A-UC`.

> Lưu ý về tên trạng thái nội bộ: một số enum trạng thái trong code khác wording với doc (ví dụ no-show khởi tạo `'risk'` thay vì `DETECTED`, early-vacancy dùng `early_empty` thay vì `RELEASED_EARLY`). Điều này được ghi ở cột Ghi chú, không làm mất tính DONE nếu hành vi khớp.

---

## 7.1. Bảng chính (158 dòng, UC-01 → UC-158)

| UC | Tên | Module | Status | Bằng chứng (file:line) | Ghi chú |
|---|---|---|---|---|---|
| UC-01 | Đăng nhập hệ thống | Auth | DONE | auth.controller.ts:53 → login.service.ts:43 | bcrypt verify, chặn non-active, cấp access+refresh, 401 khi sai |
| UC-02 | Đăng xuất | Auth | DONE | auth.controller.ts:91 → logout.service.ts:19 | Blacklist jti trong Redis theo TTL, ghi audit |
| UC-03 | Đặt lại mật khẩu bằng OTP | Auth | DONE | auth.controller.ts:136/168 → password-reset.service.ts:32/151 | OTP 6 số, hash SHA-256 Redis TTL 10m, email OTP, đổi mật khẩu txn |
| UC-04 | Đổi mật khẩu | Auth | DONE | auth.controller.ts:199 → change-password.service.ts:55 | Verify mật khẩu cũ, txn, thu hồi token. **Thiếu email cảnh báo** (xem §7.5) |
| UC-05 | Tạo tài khoản import Excel | Account | DONE | users.controller.ts:145 → account-import.service.ts:150 | Parse xlsx, txn/row, random temp pw, enqueue email/user (commit=true) |
| UC-06 | Tạo tài khoản thủ công | Account | DONE | users.controller.ts:71 → users.service.ts:111 | Tạo 1 user, temp pw, enqueue welcome email |
| UC-07 | Khởi tạo phòng ban | Account | DONE | departments.controller.ts:43 → departments.service.ts:41 | Lưu code/name/parent/manager, dedupe + depth check, audit |
| UC-08 | Cập nhật vai trò & quyền | Account | DONE | users.controller.ts:210 (PUT) → users.service.ts:437 | Replace-set roles, soft-remove/reactivate, audit |
| UC-09 | Cập nhật thông tin nhân sự | Account | DONE | users.controller.ts:508 (PATCH) → users.service.ts:1239 | Diff-based update fullName/employeeCode/phone/position/dept |
| UC-10 | Xóa tài khoản | Account | DONE | users.controller.ts:583 (DELETE) → users.service.ts:621 | Soft-delete, chặn khi có 5 loại dependency, revoke token |
| UC-11 | Cập nhật trạng thái tài khoản | Account | DONE | users.controller.ts:288 → users.service.ts:1073 | ACTIVE↔INACTIVE, revoke token khi INACTIVE, login chặn inactive |
| UC-12 | Khóa tài khoản | Account | DONE | users.controller.ts:366 → users.service.ts:837 | LOCKED, revoke session, giữ lịch sử |
| UC-13 | Tìm kiếm tài khoản | Account | DONE | users.controller.ts:643 → users.service.ts:1669 | ILIKE fullName/email/employeeCode, phân trang |
| UC-14 | Lọc danh sách tài khoản | Account | DONE | users.controller.ts:687 (manage) → users.service.ts:1726 | Filter dept/role/status + sort allowlist + phân trang |
| UC-15 | Xem chi tiết hồ sơ | Account | DONE | users.controller.ts:740 → users.service.ts:1501 | Profile/dept/roles/manager/status, dept-scope enforced |
| UC-16 | Xem lịch sử hoạt động tài khoản | Account | DONE | audit-logs.controller.ts:45 → audit-log-query.service.ts:44 | GET /audit-logs filter `userId` (buildFilters:96) |
| UC-17 | Đăng ký & liên kết dữ liệu khuôn mặt | Account | PARTIAL | face-profile.controller.ts:34 → face-profile.service.ts:42 | Enroll portrait + link userId, nhưng **không set device_person_id** (§7.3) |
| UC-18 | Tạo cuộc họp thủ công | Meeting | DONE | meetings.controller.ts:121 → meetings.service.ts:370 | Meeting+booking+participants+event+audit txn; invite IN_APP+EMAIL |
| UC-19 | Cập nhật thời gian họp | Meeting | DONE | meetings.controller.ts:170 → meetings.service.ts:847 | Room+participant conflict recheck, IN_APP+EMAIL |
| UC-20 | Cập nhật phòng họp | Meeting | DONE | meetings.controller.ts:423 → meetings.service.ts:1539 | Availability+capacity+conflict, release old booking, IN_APP+EMAIL |
| UC-21 | Hủy cuộc họp | Meeting | DONE | meetings.controller.ts:474 → meetings.service.ts:1973 | cancelled, release booking + room_events, email hủy |
| UC-22 | Tra cứu lịch trình cá nhân | Meeting | DONE | meetings.controller.ts:732 → meetings.service.ts:2840 | day/week/month, filter status/role/room/q |
| UC-23 | Thêm thành viên nội bộ | Meeting | DONE | meetings.controller.ts:287 → meetings.service.ts:2509 | Conflict/capacity warning-token, IN_APP+EMAIL |
| UC-24 | Import thành viên Excel | Meeting | DONE | meetings.controller.ts:362 → participant-import.service.ts:167 | Parse xlsx, txn/row. Nội bộ chỉ IN_APP, external mới EMAIL (ghi chú) |
| UC-25 | Gỡ thành viên nội bộ | Meeting | DONE | meetings.controller.ts:792 (DELETE) → meetings.service.ts:3282 | Protections host/organizer, hard delete + event + audit, IN_APP+EMAIL |
| UC-26 | Tạo agenda | Meeting | DONE | meetings.controller.ts:956 (PUT agendas) → meetings.service.ts:4412 | replaceAgendas: insert item mới (order/owner/duration) |
| UC-27 | Xem agenda | Meeting | DONE | meetings.controller.ts:921 → meetings.service.ts:4191 | order ASC + tổng duration |
| UC-28 | Chỉnh sửa agenda | Meeting | DONE | meetings.service.ts:4507-4524 (trong replaceAgendas) | Item có id → update tại chỗ |
| UC-29 | Xóa agenda | Meeting | DONE | meetings.service.ts:4486-4493 (trong replaceAgendas) | Item vắng khỏi payload → delete (PUT replace gộp create/edit/delete) |
| UC-30 | Cấu hình ghi hình | Meeting | DONE | recording-config.controller.ts:29/58/72 → recording-config.service.ts:27 | enableAudio/Video/Transcription, autoStart, khóa khi đang ghi |
| UC-31 | Tạo chuỗi họp định kỳ | Meeting | MISSING | — | Không có WRITE path tới meeting_recurrence_rules (§7.3) |
| UC-32 | Xem chuỗi họp định kỳ | Meeting | MISSING | — | Không có endpoint list series |
| UC-33 | Chỉnh sửa chuỗi họp định kỳ | Meeting | MISSING | — | Code chặn edit recurring (meetings.service.ts:1580) |
| UC-34 | Hủy chuỗi họp định kỳ | Meeting | MISSING | — | Không có series-cancel path |
| UC-35 | Đặt phòng đột xuất (Ad-hoc) | Meeting | MISSING | — | BookingType.AD_HOC là dead code, không có endpoint ad-hoc (§7.3/§7.5) |
| UC-36 | Xem tổng quan trạng thái phòng realtime | Room Util | PARTIAL | rooms.controller.ts:238 → room-status.service.ts:96 | noShowStatus hardcode `null` (room-status.service.ts:151) — thiếu chiều no-show |
| UC-37 | Tìm kiếm phòng khả dụng | Room Util | DONE | rooms.controller.ts:60 → room-search.service.ts:44 | Filter capacity/area/onlyAvailable + equipment |
| UC-38 | Xem chi tiết trạng thái phòng | Room Util | PARTIAL | rooms.controller.ts:253 → room-status.service.ts:117 | noShowCase=null, releaseHistory=[] hardcode (:171-172) |
| UC-39 | Xem lịch sử sử dụng phòng | Room Util | DONE | room-usage-history.controller.ts:42 → room-usage-history.service.ts:37 | Paginated + 5 summary metrics |
| UC-40 | Xem tỷ lệ sử dụng phòng | Room Util | DONE | room-utilization-rate.controller.ts:34 → room-utilization-rate.service.ts:42 | Reservation + occupancy rate, so sánh 2 kỳ |
| UC-41 | Tạo trường hợp no-show | Room Util | DONE | scheduler.service.ts:138 → no-show-detection.service.ts:29 → no-show.service.ts:59 | Cron (gated OFF default). Status khởi tạo `'risk'` ≠ `DETECTED` |
| UC-42 | Cập nhật trường hợp no-show | Room Util | DONE | no-show.controller.ts:74 → no-show.service.ts:195 | Guard terminal state + system-owned transition |
| UC-43 | Gửi cảnh báo no-show | Room Util | DONE | scheduler.service.ts:147 → no-show-lifecycle.service.ts:107 | Set warning_sent_at (:132) + notify |
| UC-44 | Tự động giải phóng phòng | Room Util | DONE | scheduler.service.ts:167 → no-show-lifecycle.service.ts:247→149 | released_at/reason/room_events/notify, txn (gated OFF default) |
| UC-45 | Giải phóng phòng thủ công | Room Util | DONE | no-show.controller.ts:95 → no-show-lifecycle.service.ts:288 | Pre-check 404/400/409, audit |
| UC-46 | Phát hiện phòng trống sớm | Room Util | DONE | scheduler.service.ts:190 → early-vacancy.service.ts:58 | Flag-only `early_empty`, KHÔNG release booking (§7.5) |
| UC-47 | Cấu hình ngưỡng no-show | Room Util | DONE | no-show-config.controller.ts:27/35 → no-show-config.service.ts:115 | Upsert system_configs `no_show.*`, version++, audit |
| UC-48 | Cấu hình ngưỡng phòng trống sớm | Room Util | DONE | early-vacancy-config.controller.ts:29/37 → early-vacancy-config.service.ts:115 | Upsert system_configs `early_vacancy.*` |
| UC-49 | Xuất báo cáo sử dụng phòng | Room Util | DONE | room-utilization-report.controller.ts:38 → room-utilization-report.service.ts:44 + worker | 202+jobId async, renderer PDF/XLSX/CSV |
| UC-50 | Xem danh sách phòng đề xuất | Scheduling | DONE | scheduling.controller.ts:42 → scheduling.service.ts:36 | Filter capacity/status, overlap NOT EXISTS, equipment EXISTS, sort |
| UC-51 | Chọn khung giờ tối ưu | Scheduling | DONE | scheduling.controller.ts:133 → time-suggestion.service.ts:33 | Giao free windows required participants, score optional |
| UC-52 | Xử lý xung đột đặt phòng | Scheduling | DONE | meetings.service.ts:451 (overlap:192) throw ROOM_CONFLICT 409 | System-check trong create; recheck ở approval |
| UC-53 | Xử lý xung đột lịch participant | Scheduling | DONE | scheduling.controller.ts:91 → participant-conflict.service.ts:35 | Soft warning free/busy/unknown; inline trong create |
| UC-54 | Phê duyệt yêu cầu đặt phòng | Scheduling | DONE | meetings.controller.ts:642 → meeting-request-review.service.ts:70 | →SCHEDULED, block self-approval, recheck, event+audit+notify |
| UC-55 | Từ chối yêu cầu đặt phòng | Scheduling | DONE | meetings.controller.ts:687 → meeting-request-review.service.ts:464 | →CANCELLED, lưu rejectionReason, notify |
| UC-56 | Tạo phòng họp mới | Room Mgmt | DONE | rooms.controller.ts:84 → rooms.service.ts:117 | Status AVAILABLE, unique roomCode+name, txn |
| UC-57 | Cập nhật thông tin phòng | Room Mgmt | DONE | rooms.controller.ts:128 → rooms.service.ts:195 | name/capacity/location; roomCode/status immutable; audit+WS |
| UC-58 | Xóa phòng (soft delete) | Room Mgmt | DONE | rooms.controller.ts:205 → rooms.service.ts:394 | softRemove, release future booking, chặn in-progress, warn future |
| UC-59 | Tìm kiếm phòng họp | Room Mgmt | DONE | rooms.controller.ts:60 → room-search.service.ts:44 | Filter capacity/area/onlyAvailable, phân trang |
| UC-60 | Gán camera vào phòng | Room Mgmt | DONE | iot-devices.controller.ts:124 → iot-devices.service.ts:644 | Validate device/room, idempotent, set roomId txn (có NEEDS-CLARIFICATION §7.5) |
| UC-61 | Đăng ký thiết bị họp | Equipment | DONE | equipment.controller.ts:70 → equipment.service.ts:90 | Serial+code unique, status AVAILABLE |
| UC-62 | Cập nhật trạng thái lỗi thiết bị | Equipment | DONE | equipment.controller.ts:122 → equipment.service.ts:207 | Set maintenance/faulty, chặn retired/lost |
| UC-63 | Xóa thiết bị (soft delete) | Equipment | DONE | equipment.controller.ts:160 → equipment.service.ts:330 | softDelete + clear currentRoomId, RETIRED, audit |
| UC-64 | Tìm kiếm kho thiết bị | Equipment | DONE | equipment.controller.ts:197 → equipment.service.ts:402 | Filter type/status/health/room + phân trang |
| UC-65 | Phân bổ thiết bị vào phòng | Equipment | DONE | equipment.controller.ts:242 → equipment.service.ts:493 | Set currentRoomId + assignedBy/At, validate room active |
| UC-66 | Kiểm tra khả dụng thiết bị | Equipment | PARTIAL | (no dedicated route) | Không có endpoint availability riêng cho equipment (§7.3) |
| UC-67 | Đăng ký thiết bị camera/IoT | IoT | DONE | iot-devices.controller.ts:90 → iot-devices.service.ts:96 | deviceCode/type/IP/MAC/metadata, unique code+MAC |
| UC-68 | Cấu hình kết nối Face Server | IoT | PARTIAL | iot-devices.service.ts:755 (configureFaceServer ORPHANED) | Method đầy đủ nhưng KHÔNG có route gọi tới (§7.3/§7.5) |
| UC-69 | Cấu hình RTSP | IoT | DONE | iot-devices.controller.ts:191 → iot-devices.service.ts:1054 | Lưu RTSP protocol/host/port/path, password AES-encrypt |
| UC-70 | Nhận heartbeat Face Server | IoT | DONE | device-callbacks.controller.ts:14 (+hb short) → iot-devices.service.ts:1354 | Update lastSeenAt + status ONLINE |
| UC-71 | Nhận verify event Face Server | IoT | DONE | device-callbacks.controller.ts:24 (+vf) → iot-devices.service.ts:1485 | Raw store :1671, normalize inline, attendance hook :1709 |
| UC-72 | Nhận stranger event Face Server | IoT | DONE | device-callbacks.controller.ts:37 (+sf) → iot-devices.service.ts:1739 | Raw store :1906, stranger-alert hook :1949 |
| UC-73 | Lưu raw event từ thiết bị | IoT | DONE | iot-device-events.service.ts:40 → repo.save:129 | Ghi iot_device_events trong callback txn trước business hook |
| UC-74 | Chuẩn hóa payload sự kiện camera | IoT | PARTIAL | face-verify-payload.util.ts:40 (inline); normalizer ORPHANED | Pipeline normalize chuyên dụng dead-code; raw giữ processedStatus=RECEIVED (§7.5) |
| UC-75 | Nhận occupancy event Python Camera | IoT | DONE | room-camera.controller.ts:18 → occupancy-ingest.service.ts:47 → occupancy-persistence.service.ts:39 | Raw store, room_events/presence_snapshots/room_booking_usages/rooms |
| UC-76 | Tạo mapping person↔user | Device Mapping | DONE | unmapped-review.controller.ts:45 → unmapped-review.service.ts:96 | INSERT device_user_mappings; auto path face-provisioning.service.ts:358 |
| UC-77 | Tra cứu user từ verify event | Device Mapping | DONE | face-attendance.service.ts:226 (resolveMapping) ← iot-devices.service.ts:1709 | Lookup device_person_id → userId+meetingId |
| UC-78 | Xử lý person chưa map | Device Mapping | DONE | unmapped-review.controller.ts:30 → unmapped-review.service.ts:38 | List verify event không có mapping cho admin |
| UC-79 | Tạo bản ghi điểm danh thủ công | Attendance | DONE | manual-attendance.controller.ts:59 → manual-attendance.service.ts:66 | Tạo record thủ công |
| UC-80 | Cập nhật trạng thái điểm danh | Attendance | DONE | manual-attendance.controller.ts:96 → manual-attendance.service.ts:147 | Edit history qua writeAudit fromStatus/toStatus |
| UC-81 | Xem danh sách điểm danh | Attendance | DONE | attendance.controller.ts:67 → attendance.service.ts:491 | List participant/status/check-in/nguồn |
| UC-82 | Xem chi tiết bản ghi điểm danh | Attendance | DONE | attendance.controller.ts:96 → attendance.service.ts:601 | editHistory từ audit_logs |
| UC-83 | Hủy hiệu lực bản ghi điểm danh | Attendance | DONE | manual-attendance.controller.ts:168 → manual-attendance.service.ts:273 | status=INVALIDATED, giữ row, audit |
| UC-84 | Tạo điểm danh từ Face Server (cửa) | Attendance | DONE | face-attendance.service.ts:42 ← iot-devices.service.ts:1485/1709 | INSERT attendance_records `door_camera` + attendance_events |
| UC-85 | Lưu check-in Face Server + push realtime | Attendance | PARTIAL | face-attendance.service.ts:116 | Save đầy đủ nhưng **không có WebSocket push** (§7.3) |
| UC-86 | Cập nhật hiện diện realtime | Attendance | DONE | room-camera.controller.ts:16 → occupancy-persistence.service.ts:39 | status occupied + WS room.occupancy/status.updated (count==0 không flip empty) |
| UC-87 | Phát hiện khuôn mặt lạ | Attendance | DONE | iot-devices.service.ts:1739 → stranger-alert.service.ts:47 | Raw face_stranger + WS face.stranger.alert (snapshot base64 bị strip) |
| UC-88 | Xem lịch sử vào/ra người tham dự | Attendance | DONE | ivss-presence.controller.ts:29 → ivss-presence-query.service.ts:65 | Timeline enter/leave + duration |
| UC-89 | Tính tổng thời gian hiện diện | Attendance | DONE | ivss-presence-query.service.ts:173 (buildSession) durationMs:300 | Tính on-read từ cặp enter/leave (không job persisted) |
| UC-90 | Xem timeline hiện diện cuộc họp | Attendance | DONE | ivss-presence.controller.ts:50 → ivss-presence-query.service.ts:120 | Timeline occupancy theo người |
| UC-91 | Chỉnh sửa hồ sơ điểm danh thủ công | Attendance | DONE | manual-attendance.controller.ts:131 → manual-attendance.service.ts:192 | Audit changedFields trước/sau |
| UC-92 | Gửi cảnh báo chưa check-in | Attendance | DONE | scheduler.service.ts:253 → checkin-alert.service.ts:154 → email:387 | Cron; +internal POST checkin-alert.controller.ts:19 |
| UC-93 | Gửi cảnh báo khuôn mặt lạ | Attendance | DONE | stranger-alert.service.ts:91 | IN_APP + email; recipients chỉ role `admin` (Manager thiếu §7.5) |
| UC-94 | Bắt đầu phiên họp | In-Meeting | DONE | live-meeting.controller.ts:64 → live-meeting.service.ts:150 (:481) | IN_PROGRESS + actualStartTime, event+audit txn |
| UC-95 | Yêu cầu gia hạn phiên họp | In-Meeting | DONE | live-meeting.controller.ts:120 → live-meeting.service.ts:684 | Tạo meeting_requests EXTEND; auto-apply khi không conflict (ghi chú) |
| UC-96 | Phê duyệt/từ chối gia hạn | In-Meeting | DONE | live-meeting.controller.ts:180 → live-meeting.service.ts:1545 (:1652) | Conflict recheck, auto-reject khi overlap |
| UC-97 | Cập nhật end time sau gia hạn | In-Meeting | DONE | live-meeting.service.ts:954-988 / 1679-1702 | Update meetings.endTime + reservedEndTime + usage |
| UC-98 | Kết thúc phiên họp | In-Meeting | DONE | live-meeting.controller.ts:252 → live-meeting.service.ts:1884 (:2051) | COMPLETED + actualEndTime + early-release |
| UC-99 | Xem timeline cuộc họp | In-Meeting | DONE | live-meeting.controller.ts:733 → live-meeting.service.ts:3201 | Merge events/attendance/notes |
| UC-100 | Xem người đang có mặt | In-Meeting | DONE | live-meeting.controller.ts:305 → live-meeting.service.ts:2250 | Presence từ snapshots + attendance, occupancy count |
| UC-101 | Xem trạng thái điểm danh người tham dự | In-Meeting | DONE | live-meeting.controller.ts:458 → live-meeting.service.ts:2527 | Late-threshold từ system_configs, role/status |
| UC-102 | Thêm ghi chú trong cuộc họp | In-Meeting | DONE | live-meeting.controller.ts:551 → live-meeting.service.ts:2886 | Sanitize, visibility, in_progress guard, timestamp |
| UC-103 | Xem ghi chú trong cuộc họp | In-Meeting | DONE | live-meeting.controller.ts:611 → live-meeting.service.ts:3694 (:3824) | Visibility host/co-host/participant |
| UC-104 | Tìm kiếm ghi chú trong cuộc họp | In-Meeting | DONE | cùng route :611; view-notes-query.dto.ts:23 `q`; FTS :3857 | tsvector/plainto_tsquery sau filter visibility |
| UC-105 | Lập lịch cảnh báo thời gian còn lại | In-Meeting | DONE | live-meeting.service.ts:4026 (scheduleWarningJob, default 10m:142) | Enqueue BullMQ khi start/extend |
| UC-106 | Gửi cảnh báo thời gian còn lại | In-Meeting | DONE | meeting-warning.processor.ts:26 → meeting-warning.service.ts:385 | Notif + WS tới host |
| UC-107 | Cảnh báo xung đột thời gian kết thúc | In-Meeting | PARTIAL | meeting-warning.service.ts:138/247 | Chặn tự gia hạn OK; **chỉ notify host, thiếu Room Admin** (§7.3) |
| UC-108 | Tạo cấu hình ghi âm/ghi hình | Recording | DONE | recording-config.controller.ts:29 → recording-config.service.ts:27 | enableVideo/Audio, camera, autoStart. Không có field capture-agent/seat |
| UC-109 | Xem cấu hình ghi âm/ghi hình | Recording | DONE | recording-config.controller.ts:58 → recording-config.service.ts:102 | Trả config đã lưu (không probe live) |
| UC-110 | Cập nhật cấu hình ghi âm/ghi hình | Recording | DONE | recording-config.controller.ts:72 → recording-config.service.ts:116 | Khóa khi đang ghi → 409 RECORDING_IN_PROGRESS |
| UC-111 | Bắt đầu ghi hình IP Camera | Recording | DONE | recording-session.controller.ts:34 → recording-session.service.ts:67 | FFmpeg RTSP→MP4 + probe + metadata. Storage **local** không S3 (§7.5) |
| UC-112 | Bắt đầu ghi âm theo channel/seat | Recording | PARTIAL | recording-session.controller.ts:126/156/205 → service:697/812/949 | Chỉ audio-upload/track, không Capture Agent live, không seat (§7.3) |
| UC-113 | Tạo audio segment theo channel/seat | Recording | MISSING | recording-segment.entity.ts:20 (entity only) | Không route/service/worker ghi recording_segments (§7.3/§7.5) |
| UC-114 | Tạm dừng ghi | Recording | DONE | recording-session.controller.ts:83 → recording-session.service.ts:390 | markStopping+stop, save segment metadata, paused |
| UC-115 | Tiếp tục ghi | Recording | DONE | recording-session.controller.ts:103 → recording-session.service.ts:468 | Segment ffmpeg mới + no-data guard, accrue pausedDuration |
| UC-116 | Dừng ghi hình IP Camera | Recording | DONE | recording-session.controller.ts:58 → recording-session.service.ts:249 | Stop, concat segment, duration, checksum. Local storage (§7.5) |
| UC-117 | Dừng ghi âm | Recording | MISSING | (no route) | Không có stop-audio endpoint; audio session tạo sẵn STOPPED (§7.3) |
| UC-118 | Đồng bộ metadata video & audio | Recording | MISSING | (none) | Không có code sync UTC video↔audio (§7.3) |
| UC-119 | Tạo metadata file phương tiện | Recording | DONE | recording-session.service.ts:1194 (INSERT media_files :1242) | Trigger bởi stop/upload + boot reconcile |
| UC-120 | Xem danh sách file | Recording | DONE | media-files.controller.ts:34 → media-files.service.ts:41 | Paginated theo meeting, ẩn deleted |
| UC-121 | Xem chi tiết file | Recording | DONE | media-files.controller.ts:53 → media-files.service.ts:78 | Detail + probe (source/channel/size/status) |
| UC-122 | Phát lại file | Recording | DONE | media-files.controller.ts:67 → media-files.service.ts:106 (:159) | Local stream + Range + HMAC signed-download (không S3 presigned §7.5) |
| UC-123 | Xóa/ẩn file recording | Recording | DONE | media-files.controller.ts:141 → media-files.service.ts:151 | hide/soft_delete, giữ file trên đĩa |
| UC-124 | Thông báo lỗi ghi | Recording | PARTIAL | recording-session.service.ts:190-206; reconcile:106 | Persist failed+error_message, **không realtime alert / không /error route** (§7.3) |
| UC-125 | Chuyển giọng nói thành văn bản | Transcription | DONE | transcription-worker.processor.ts:77/162 → transcription.service.ts:378 | Queue STT worker; segment speakerLabel/userId per channel |
| UC-126 | Xem transcript | Transcription | DONE | transcription.controller.ts:102 → transcription.service.ts:280 | Timeline/timestamp/speaker, pagination |
| UC-127 | Chỉnh sửa transcript thủ công | Transcription | DONE | transcript-segments.controller.ts:43 → transcription.service.ts:482 (:562) | editRevisionNo increment, editedBy/At |
| UC-128 | Bảo mật xử lý dữ liệu STT | Transcription | NOT-A-UC | (access-control tồn tại; không có code mã hóa) | NFR: access-control đã có qua guard UC-125/126/127; không actor riêng (§7.3) |
| UC-129 | Tạo biên bản họp nháp | Minutes | DONE | minutes.controller.ts:35 → minutes.service.ts:125 | status DRAFT, bind meetingId, txn + host check |
| UC-130 | Xem danh sách biên bản | Minutes | DONE | minutes-list.controller.ts:49 → minutes.service.ts:279 | Role-scoped visibility |
| UC-131 | Xem chi tiết biên bản | Minutes | DONE | minutes-list.controller.ts:157 → minutes.service.ts:861 | content + attachments + related resources |
| UC-132 | Cập nhật nội dung biên bản | Minutes | DONE | minutes-list.controller.ts:195 → minutes.service.ts:1141 | draft-only, optimistic versionNo |
| UC-133 | Xóa biên bản nháp | Minutes | DONE | minutes-list.controller.ts:243 → minutes.service.ts:1302 | status=DELETED + deletedAt, cascade attachments |
| UC-134 | Lọc biên bản theo thời gian | Minutes | DONE | minutes.service.ts:369-374 (trong list :49) | from/to BETWEEN meeting.actualStartTime (cần cả from+to) |
| UC-135 | Tìm kiếm biên bản theo nhân sự | Minutes | DONE | minutes-list.controller.ts:113 → minutes.service.ts:1580 | Manager scoped dept, admin all |
| UC-136 | Cấu hình quyền hiển thị biên bản | Minutes | MISSING | (chỉ PRIVATE được ghi) | UpdateDraftMinutesDto không expose visibilityLevel (§7.3/§7.5) |
| UC-137 | Ban hành biên bản chính thức | Minutes | DONE | minutes-list.controller.ts:285 → minutes.service.ts:1435 (:1547) | draft→published, issuedBy/At, notification |
| UC-138 | Tải lên tệp đính kèm | Minutes | DONE | minutes-list.controller.ts:324 → minutes.service.ts:494 | Storage save + INSERT media_files (driver LOCAL cấu hình hiện tại) |
| UC-139 | Xem danh sách tệp đính kèm | Minutes | DONE *(re-audit)* | minutes-list.controller.ts:392 (list) + media-files.controller.ts:53 → media-files.service.ts:82 (:113 buildSignedDownloadUrl) | Signed download đã có qua /media-files/:fileId (commit ac17cd7). Caveat: body list vẫn trả fileUrl tĩnh (§7.7) |
| UC-140 | Xem chi tiết tệp đính kèm | Minutes | DONE *(re-audit)* | media-files.controller.ts:53 → media-files.service.ts:82 (:113 buildSignedDownloadUrl) | GET /media-files/:fileId trả tên/loại/size/uploadedAt + signed URL; phục vụ cả minutes attachment (§7.7) |
| UC-141 | Liên kết recording/transcript với biên bản | Minutes | DONE *(re-audit)* | minutes-list.controller.ts:344 (PATCH link-resources) → minutes.service.ts:1400 (write linkedRecordingFileId:1544 + linkedTranscriptId:1547) | Validate same-meeting + file type audio/video + draft/completed; audit (§7.7) |
| UC-142 | Xóa tệp đính kèm khỏi biên bản | Minutes | DONE | minutes-list.controller.ts:437 → minutes.service.ts:748 | Set deletedAt (soft), draft-only, owner-only |
| UC-143 | Phát hành thư mời họp | Notification | DONE | meetings.service.ts:701 (MEETING_INVITE) → :805/:825 enqueueEmail | Email send trên create; nội dung tối thiểu (chỉ title) |
| UC-144 | Gửi nhắc nhở lịch họp | Notification | PARTIAL | scheduler.service.ts:238 (cron body TODO no-op :239-246) | Cron đăng ký nhưng chưa có logic gửi reminder (§7.3/§7.5) |
| UC-145 | Phát thông báo hủy cuộc họp | Notification | DONE | meetings.service.ts:1973 → :2289 IN_APP + :2321 email `[CANCELLED]` | Flow hủy thật |
| UC-146 | Phân phối biên bản cuộc họp | Notification | PARTIAL | minutes.service.ts:1821 (IN_APP MINUTES_DISTRIBUTION); shareMinutes:1907 tạo share record | Có thêm share-with-user; vẫn **không gửi email** + không attach/link (§7.3/§7.7) |
| UC-147 | Xuất biên bản cuộc họp (PDF/Word) | Notification | DONE *(re-audit)* | minutes-list.controller.ts:515 (POST exports) → minutes-export.service.ts:52 → minutes-export-worker.processor.ts:69 (render PDF/DOCX:130, saveFile:142, media_files:156) | Async qua background_jobs; tải qua media-files signed URL (§7.7) |
| UC-148 | Dashboard tổng quan hệ thống | Analytics | DONE | dashboard-overview.controller.ts:34 → DashboardOverviewService.getOverview | KPI tổng hợp |
| UC-149 | Dashboard sử dụng phòng | Analytics | DONE | room-usage-dashboard.controller.ts:40 → getComparisonDashboard | utilization/occupancy theo thời gian |
| UC-150 | Dashboard điểm danh & hiện diện | Analytics | DONE | on-time-rate.controller.ts:40 → OnTimeRateService.getOnTimeRate | onTime/late/absent + lateByDepartment |
| UC-151 | Thống kê số cuộc họp theo thời gian | Analytics | DONE | meeting-count-by-period.controller.ts:34 → getCountByPeriod | day/week/month |
| UC-152 | Thống kê cuộc họp theo trạng thái | Analytics | DONE | meeting-status-breakdown.controller.ts:34 → getStatusBreakdown | Scheduled/Completed/Cancelled/No-show |
| UC-153 | Thống kê thời lượng trung bình | Analytics | DONE | meeting-average-duration.controller.ts:34 → getAverageDuration | Plan vs actual |
| UC-154 | Thống kê tỷ lệ cuộc họp bị hủy | Analytics | DONE | meeting-cancel-rate.controller.ts:34 → getCancelRate | Theo dept/organizer/room |
| UC-155 | Thống kê tỷ lệ sử dụng phòng tổng hợp | Analytics | DONE | room-utilization-rate.controller.ts:34 + reports/room-utilization exports | KPI + export CSV/XLSX/PDF |
| UC-156 | Thống kê tỷ lệ no-show theo phòng | Analytics | DONE | no-show-rate.controller.ts:34 → getNoShowRate | Theo phòng/dept/organizer |
| UC-157 | Thống kê tỷ lệ tham dự đúng giờ | Analytics | DONE | on-time-rate.controller.ts:40 → on-time-rate.service.ts:47 | graceMinutes cấu hình được |
| UC-158 | Xuất báo cáo hoạt động cuộc họp | Analytics | DONE | meeting-activity-report.controller.ts:38 → worker:76-167 | Async, PDF/XLSX, StorageService (S3/local) + MediaFile |

---

## 7.2. Tổng kết số

Số liệu SAU re-audit 2026-07-18 (HEAD 5f353d1):

| Status | Số lượng | % (trên 158) |
|---|---:|---:|
| DONE | 136 | 86.1% |
| PARTIAL | 12 | 7.6% |
| MISSING | 9 | 5.7% |
| NOT-A-UC | 1 | 0.6% |
| **Tổng** | **158** | **100.0%** |

- **PARTIAL (12)**: UC-17, UC-36, UC-38, UC-66, UC-68, UC-74, UC-85, UC-107, UC-112, UC-124, UC-144, UC-146.
- **MISSING (9)**: UC-31, UC-32, UC-33, UC-34, UC-35, UC-113, UC-117, UC-118, UC-136.
- **NOT-A-UC (1)**: UC-128.

> Số liệu audit lần đầu (HEAD f80d3da): DONE 132 (83.5%), PARTIAL 14 (8.9%), MISSING 11 (7.0%), NOT-A-UC 1. Thay đổi: UC-139/UC-141 (PARTIAL→DONE), UC-140/UC-147 (MISSING→DONE). Chi tiết §7.7.

---

## 7.3. Chi tiết mọi UC ≠ DONE

### UC-17 — PARTIAL (Liên kết dữ liệu khuôn mặt)
- **Đã tìm**: grep `devicePersonId|device_person_id` trong `src/modules/accounts` → không có; grep repo-wide → chỉ iot/face-access.
- **Có gì**: `POST /users/:userId/face-profile` (face-profile.controller.ts:34 → face-profile.service.ts:42) enroll portrait vào media_files + upsert face_profiles theo userId, status PENDING_REVIEW.
- **Thiếu**: phần "liên kết với device_person_id". enrollPortrait không ghi device_person_id. Linkage device_person_id nằm ở flow khác (face-access/unmapped-verifies/map — UC-76).
- **Độ chắc**: chắc về việc không set device_person_id; hơi không chắc về diễn giải intent UC-17.

### UC-31/32/33/34 — MISSING (Chuỗi họp định kỳ)
- **Đã grep**: `recurrence`, `recurring`, `recurrenceRule`, `meeting_recurrence_rules`, `rrule`, `frequency`, `weekly/daily/monthly`, `series`.
- **Đã tìm ở**: toàn `src/**`, create-meeting.dto.ts (không field recurrence), meetings.service.ts (mọi ref chỉ READ/guard: :1580 chặn edit recurring, :3103 trả recurrenceRuleId, :3391/:3910 reject SERIES scope), tất cả controller.
- **Chỉ tồn tại**: entity `meeting_recurrence_rules`, đăng ký module, relation `@ManyToOne` → không phải artifact hợp lệ.
- **Thiếu**: sinh danh sách từ rule (31), view series (32), edit propagate (33), cancel series (34).
- **Độ chắc**: cao.

### UC-35 — MISSING (Ad-hoc booking)
- **Đã grep**: `ad-hoc`, `adhoc`, `ad_hoc`, `AdHoc`, `instant`, `walk-in`, `BookingType.AD_HOC`, `createBooking`, `reserveRoom`.
- **Đã tìm ở**: `src/modules/rooms/**` (POST duy nhất là tạo phòng), tất cả controller. `room-booking.entity.ts:16` định nghĩa `AD_HOC` nhưng không được assign ở đâu.
- **Thiếu**: endpoint "đặt ngay", override conflict participant riêng cho ad-hoc; AD_HOC là dead code. `POST /meetings` chung route sang PENDING_APPROVAL, không phải instant booking.
- **Độ chắc**: cao.

### UC-36 — PARTIAL (Realtime room overview)
- **Thiếu**: `noShowStatus` trả literal `null` cho mọi phòng (room-status.service.ts:151, comment "No-show defer #31"). available/reserved + occupancy có; chiều no-show không merge vào view realtime.
- **Độ chắc**: trung bình-cao.

### UC-38 — PARTIAL (Room status detail)
- **Thiếu**: `noShowCase: null` và `releaseHistory: []` hardcode (room-status.service.ts:171-172). Booking/host/time/occupancy có; no-show status + release history (yêu cầu UC) không implement.
- **Độ chắc**: trung bình-cao.

### UC-66 — PARTIAL (Kiểm tra khả dụng thiết bị equipment)
- **Đã grep**: `availability`, `checkAvailability`, `getAvailability` trong `src/modules/equipment`; đọc toàn bộ equipment.controller.ts (chỉ POST/PATCH fault/DELETE/GET list/PATCH assignment).
- **Thiếu**: không có endpoint/service "check availability" cho equipment asset; dữ liệu chỉ lấy gián tiếp qua GET /equipments (UC-64). Route `check-availability` ở iot-devices.controller.ts:302 là cho camera/face-server, không phải equipment.
- **Độ chắc**: cao.

### UC-68 — PARTIAL (Cấu hình Face Server)
- **Có gì**: `configureFaceServer` (iot-devices.service.ts:755) đầy đủ — validate FACE_SERVER + room, lưu callback config + sinh one-time token (:792/:844).
- **Thiếu**: KHÔNG route nào gọi `configureFaceServer` (orphaned). Chỉ có rotate (:245) / revoke (:219); rotate 409 `FACE_SERVER_NOT_CONFIGURED` nếu chưa config → flow config ban đầu không thể trigger qua API.
- **Độ chắc**: cao.

### UC-74 — PARTIAL (Chuẩn hóa payload)
- **Có gì**: extraction inline `parseVerifyPayload` (face-verify-payload.util.ts:40) chạy trong callback, lưu `payload_json.extracted_fields`.
- **Thiếu**: pipeline chuẩn hóa chuyên dụng `normalizeRawEvent`/`normalizePendingRawEvents`/`buildNormalizedEvent` (iot-device-events.service.ts:138/198/242) KHÔNG có route/cron gọi → dead-code; raw giữ `processedStatus=RECEIVED`, không lên PROCESSED.
- **Độ chắc**: trung bình-cao (inline có thể xem là DONE, nhưng deliverable normalized_event không được wire).

### UC-85 — PARTIAL (Check-in Face Server + push realtime)
- **Có gì**: onVerify (face-attendance.service.ts:116-139) INSERT attendance_records (check_in_time, status) + attendance_events (check_in).
- **Thiếu**: `FaceAttendanceService` chỉ inject DataSource+ConfigService, KHÔNG có WS emit; websocket module không có event attendance/check-in. Clause "push realtime" chưa implement.
- **Độ chắc**: cao.

### UC-107 — PARTIAL (Cảnh báo xung đột end-time)
- **Có gì**: Branch B strict conflict warning (meeting-warning.service.ts:247-285, extensionAllowed=false, priority HIGH); "không cho tự gia hạn" enforced end-to-end (live-meeting.service.ts:847-868 + decideExtension auto-reject :1660-1667).
- **Thiếu**: "Thông báo Room Admin" — recipient chỉ `[hostId]` (meeting-warning.service.ts:280); không resolve/notify Room Admin.
- **Độ chắc**: cao.

### UC-112 — PARTIAL (Ghi âm theo channel/seat)
- **Thiếu**: Capture Agent live multi-channel + seat metadata. Có: manual audio-upload + per-participant track (channel_user_id).
- **Độ chắc**: cao.

### UC-113 — MISSING (Audio segment channel/seat)
- **Đã grep**: `recording_segments|RecordingSegment|createSegment`. Chỉ hit entity + module registration. Video pause/resume "segments" lưu trong `recording_sessions.metadata_json`, không phải bảng `recording_segments`.
- **Độ chắc**: cao.

### UC-117 — MISSING (Dừng ghi âm)
- **Thiếu**: không có stop-audio endpoint. Audio session tạo sẵn STOPPED (recording-session.service.ts:883) hoặc placeholder STARTING; không có host action đóng/finalize session audio đang chạy.
- **Độ chắc**: cao.

### UC-118 — MISSING (Đồng bộ metadata video & audio)
- **Đã grep**: `sync`, `timestamp`, `utc`, `syncMetadata`. Không có code align video↔audio theo UTC. resolveStopFile chỉ concat video segment.
- **Độ chắc**: cao.

### UC-124 — PARTIAL (Thông báo lỗi ghi)
- **Có gì**: persist status=failed + error_message (start no-data/exit + boot reconcile).
- **Thiếu**: "gửi cảnh báo realtime" (không emit/Gateway/Notification), không trạng thái "degraded", không route `POST .../:id/error`.
- **Độ chắc**: cao.

### UC-128 — NOT-A-UC (Bảo mật xử lý STT)
- Access-control thật (guard `transcript.*` + Host/Admin check). Nhưng phần "mã hóa audio/transcript" không có code enforce; STT provider là subprocess local; không có actor endpoint riêng → NFR.
- **Độ chắc**: cao.

### UC-136 — MISSING (Cấu hình visibility biên bản)
- **Đã grep**: `visibilityLevel` toàn `src/**`. Trong minutes chỉ ghi `PRIVATE` (minutes.service.ts:232, ai-draft :291). `UpdateDraftMinutesDto` không expose field; `forbidNonWhitelisted` sẽ reject field lạ. Logic visibility phong phú ở live-meeting.service.ts là cho `meeting_notes` (entity/UC khác).
- **Độ chắc**: cao.

### UC-139 — ~~PARTIAL~~ → DONE (re-audit 2026-07-18)
- Signed-URL download đã có qua `GET /media-files/:fileId` → `media-files.service.ts:82` (`buildSignedDownloadUrl` :113) + `/secure-download` :159; RBAC nới rộng ở commit ac17cd7. Attachment biên bản là `media_files` (`relatedEntityType='meeting_minutes'`) nên dùng chung route này.
- Caveat còn lại: endpoint list biên bản (`minutes.service.ts:823`) vẫn emit `fileUrl` tĩnh trong body; signed URL lấy qua call `/media-files/:fileId` riêng.

### UC-140 — ~~MISSING~~ → DONE (re-audit 2026-07-18)
- Route `GET /media-files/:fileId` (media-files.controller.ts:53 → media-files.service.ts:82) trả fileName/fileType/mimeType/fileSizeBytes/uploadedAt + `downloadUrl` (signed via `buildSignedDownloadUrl` :113). Không có route minutes-native `/meeting-minutes/:id/attachments/:fileId`, nhưng route media-files dùng chung thỏa Expected Output (chi tiết file + signed URL).

### UC-141 — ~~PARTIAL~~ → DONE (re-audit 2026-07-18)
- Endpoint user thao tác: `PATCH /meeting-minutes/:id/link-resources` (minutes-list.controller.ts:344, perm `meeting.minutes.link_resources`) → `minutes.service.ts:1400` `linkResources` GHI `linkedRecordingFileId` (:1544) + `linkedTranscriptId` (:1547), validate same-meeting (:1498/:1526) + file type audio/video (:1482) + draft/meeting completed; audit :1556. Write path cho recording-link (trước đây thiếu) đã có.

### UC-144 — PARTIAL (Nhắc nhở lịch họp)
- **Thiếu**: body cron `notification-reminder` (scheduler.service.ts:238-246) là TODO no-op (chỉ log). Không có `sendScheduledReminders`, không query meeting sắp diễn ra, không dispatch. Gated OFF default.
- **Độ chắc**: cao.

### UC-146 — PARTIAL (Phân phối biên bản) — re-audit 2026-07-18: VẪN PARTIAL
- **Có thêm (code mới)**: `shareMinutes` (minutes.service.ts:1907) tạo share record (:1958) + audit (:1979) → tính năng "chia sẻ biên bản với user khác" (cấp quyền đọc).
- **Vẫn thiếu**: gửi EMAIL đính kèm/link biên bản. Distribution lúc issue (minutes.service.ts:1821-1831) chỉ IN_APP; `shareMinutes` cũng không gửi email/notification cho user được chia sẻ. Grep `EMAIL|Mail|mailer|sendMail` trong module minutes = 0 hit.
- **Độ chắc**: cao.

### UC-147 — ~~MISSING~~ → DONE (re-audit 2026-07-18)
- Pipeline export đầy đủ đã landed: `POST /meeting-minutes/:id/exports` (minutes-list.controller.ts:515, 202+jobId, perm `meeting.minutes.export`) → `minutes-export.service.ts:52` `createExportJob` (check published+owner, `createQueuedJob` :110, `addJob` :124) → processor `minutes-export-worker.processor.ts:69` render PDF/DOCX (:130 qua renderers/meeting-minutes-*-renderer.ts), `storageService.saveFile` :142, tạo `MediaFileEntity` :156, `markCompleted`+`outputFileId` :173-182, audit :196. Tải qua media-files signed URL. Async qua background_jobs + BullMQ.

---

## 7.4. Code thừa (route/cron KHÔNG map vào bất kỳ UC nào trong 158)

### A. Module ANPR — nhận diện biển số xe (hoàn toàn ngoài 158 UC)
| Route | File |
|---|---|
| GET anpr/vehicle-history | anpr/controllers/vehicle-registration.controller.ts:55 |
| GET anpr/admin/vehicle-history | :75 |
| GET anpr/admin/unknown-vehicles | :90 |
| GET anpr/vehicle-registrations | :107 |
| GET anpr/vehicle-registrations/:id | :127 |
| POST anpr/vehicle-registrations | :145 |
| POST anpr/admin/vehicle-registrations | :165 |
| PATCH anpr/vehicle-registrations/:id | :185 |
| PATCH anpr/vehicle-registrations/:id/status | :206 |
| DELETE anpr/vehicle-registrations/:id | :227 |
| POST internal/ivss/vehicle-events | anpr/controllers/vehicle-webhook.controller.ts:37 |

### B. Avatar submission & moderation (accounts) — không có UC riêng
| Route | File |
|---|---|
| GET me/avatar-status | avatar.controller.ts:55 |
| POST me/avatar-submission | avatar.controller.ts:80 |
| GET admin/avatar-submissions | admin-avatar-review.controller.ts:37 |
| GET admin/avatar-submissions/:faceProfileId | :50 |
| GET admin/avatar-submissions/:faceProfileId/download-url | :64 |
| POST admin/avatar-submissions/:faceProfileId/approve | :82 |
| POST admin/avatar-submissions/:faceProfileId/reject | :97 |

> Ghi chú: flow này liên quan gián tiếp face_profiles/UC-17 nhưng là quy trình duyệt ảnh đại diện, không phải một UC nào trong 158.

### C. AI Draft Minutes (minutes) — không có UC (thuộc feature AI provisional)
| Route | File |
|---|---|
| POST meetings/:meetingId/minutes/ai-draft-jobs | minutes-ai-draft.controller.ts:39 |
| GET meetings/:meetingId/minutes/ai-draft-jobs | :105 |
| GET meetings/:meetingId/minutes/ai-draft-config | :146 |

### D. IoT device lifecycle ops — thao tác quản trị thiết bị không có UC riêng
| Route | File |
|---|---|
| GET iot-devices (list) | iot-devices.controller.ts:36 |
| GET iot-devices/status-summary | :53 |
| GET iot-devices/:id | :67 |
| POST iot-devices/probe-status | :108 |
| PATCH iot-devices/:id | :152 |
| POST iot-devices/:id/face-server/revoke | :208 |
| POST iot-devices/:id/face-server/rotate | :241 |
| POST iot-devices/:id/disable | :268 |
| POST iot-devices/:id/enable | :285 |
| POST iot-devices/:id/check-availability | :302 |

### E. Ingestion/tích hợp IVSS song song (một phần trùng UC-75/86/88-90 nhưng qua path khác)
| Route | File | Ghi chú |
|---|---|---|
| GET ivss/health | ivss-health.controller.ts:19 | health-check hạ tầng |
| POST internal/ivss/occupancy-events | ivss-occupancy.controller.ts:30 | Path occupancy thứ 2 (UC-75 dùng room-camera/occupancy-snapshots) |
| POST internal/ivss/events | ivss-webhook.controller.ts:32 | Webhook IVSS chung, không map UC cụ thể |
| GET ivss/meetings/:meetingId/presence/report | ivss-presence.controller.ts:65 | Report presence — không có UC report presence riêng |

### F. Meeting external participants — quản lý khách ngoài (158 UC chỉ có participant nội bộ)
| Route | File |
|---|---|
| POST meetings/:meetingId/participants/external | meetings.controller.ts:845 |
| DELETE meetings/:meetingId/participants/external/:externalParticipantId | meetings.controller.ts:881 |

### G. Tiện ích hạ tầng / dev
| Route | File |
|---|---|
| GET / (root) | app.controller.ts:8 |
| GET health | health/health.controller.ts:60 |
| POST dev/test-mail | dev/dev.controller.ts:30 |
| POST dev/test-mail-verify | dev/dev.controller.ts:60 |

### H. Cron KHÔNG map vào UC 158
| Cron | File | Ghi chú |
|---|---|---|
| face-sync (EVERY_MINUTE) | scheduler.service.ts:89 | Đồng bộ face/device — không có UC sync trong 158 |
| face-reconcile (EVERY_5_MINUTES) | scheduler.service.ts:105 | Reconcile mapping — không có UC |
| device-offline-detect (EVERY_MINUTE) | scheduler.service.ts:124 | Device health — không có UC |
| ivss-sync (EVERY_MINUTE) | scheduler.service.ts:212 | IVSS sync — không có UC |

> Các route hỗ trợ (GET meeting-requests list, GET meetings/:id detail, rooms/available, face-access/stranger-alerts GET, attendance internal late-checkin-alerts, recording audio-sessions phụ trợ...) không liệt kê ở §7.4 vì chúng phục vụ trực tiếp một UC có trong danh sách (approval, meeting view, UC-87/92/112...). Chúng là artifact bổ trợ, không phải "code thừa".

---

## 7.5. Nghi vấn bug / bỏ dở / hardcode / mâu thuẫn doc (GHI, KHÔNG SỬA)

1. **UC-04 thiếu email cảnh báo** — change-password.service.ts:55-180 không dispatch email cảnh báo dù Expected Output yêu cầu. Đã đọc full body.
2. **Room realtime/detail hardcode no-show** — room-status.service.ts:151 (`noShowStatus=null`), :171-172 (`noShowCase=null`, `releaseHistory=[]`). Comment "No-show defer #31". Dữ liệu no-show không được merge vào view phòng.
3. **Early-vacancy chỉ flag, không release** — early-vacancy.service.ts:58 set `usage_status='early_empty'`, KHÔNG release booking, KHÔNG set `RELEASED_EARLY` (ARCH-01: không mutate room_bookings). Lệch wording doc UC-46.
4. **No-show naming lệch doc** — khởi tạo status `'risk'` thay vì `DETECTED` (no-show.service.ts:59). Hành vi đúng nhưng wording khác spec.
5. **configureFaceServer là orphaned/dead-code** — iot-devices.service.ts:755 đầy đủ nhưng không route nào gọi; rotate 409 `FACE_SERVER_NOT_CONFIGURED` (:989) nếu chưa config → không thể cấu hình Face Server ban đầu qua API (UC-68 tắc).
6. **Normalizer camera là dead-code** — iot-device-events.service.ts:138/198/242 (`normalizeRawEvent`/`normalizePendingRawEvents`/`buildNormalizedEvent`) không có caller; raw event mãi ở `processedStatus=RECEIVED`, không bao giờ lên PROCESSED (UC-74).
7. **recording_segments không bao giờ được ghi** — bảng/entity tồn tại (recording-segment.entity.ts:20) nhưng segment thực tế lưu vào `recording_sessions.metadata_json`. Entity mồ côi (UC-113).
8. **Cron reminder là no-op** — scheduler.service.ts:238-246 body chỉ `// TODO` + log; không gửi reminder (UC-144). Gated OFF default.
9. **Export minutes chỉ scaffolding** — enum `EXPORT_MINUTES` (background-job.entity.ts:17) + env `QUEUE_MINUTES_EXPORT` (env.validation.ts:102) tồn tại nhưng không processor/route nào tham chiếu (UC-147).
10. **BookingType.AD_HOC là dead code** — room-booking.entity.ts:16 định nghĩa nhưng không assign ở đâu (UC-35).
11. **Cảnh báo khuôn mặt lạ chỉ tới `admin`** — stranger-alert.service.ts:119 resolveAdmins chỉ role `admin`; doc UC-93 nói cả Manager.
12. **Check-in cửa không push realtime** — FaceAttendanceService không inject WebsocketService; không WS emit ở door check-in path (UC-85).
13. **Cảnh báo end-time conflict chỉ tới host** — meeting-warning.service.ts:280 recipient `[hostId]`; doc UC-107 yêu cầu thông báo Room Admin.
14. **assignRoom có [NEEDS CLARIFICATION]** — iot-devices.service.ts:661 comment chưa chốt việc có chặn device OFFLINE khi gán vào phòng (UC-60).
15. **Recording video local-only vs S3 trong spec** — recording-session.service.ts dùng `storageProvider='local'` + serve local stream/HMAC; doc UC-111/116/122 nhắc S3 presigned. Cloud redirect chỉ cho uploaded file, không cho video recording.
16. **visibilityLevel biên bản không ghi được** — enum + column tồn tại (meeting-minutes.entity.ts:53) nhưng `UpdateDraftMinutesDto` không expose và `forbidNonWhitelisted` reject field lạ; chỉ `PRIVATE` từng được set (UC-136). Cột enum tồn tại nhưng không có write path — bẫy hardcode.
17. **Nhiều path ingestion occupancy song song** — `room-camera/occupancy-snapshots` (presence, UC-75 evidence) vs `internal/ivss/occupancy-events` (ivss) vs `internal/ivss/events` (ivss-webhook). Có khả năng chồng chéo/khó xác định path production chuẩn.

---

## 7.6. Số liệu thô (đối chiếu chéo)

- **Tổng controller (không tính `.spec.ts`)**: 59 file. Lệnh: `find src -name "*.controller.ts" ! -name "*.spec.ts" | wc -l`.
- **Tổng route (decorator HTTP verb)**: 203. Lệnh: `grep -rhnE "@(Get|Post|Patch|Put|Delete)\(" src --include="*.controller.ts" | grep -v ".spec.ts" | wc -l`. (Bao gồm cả cặp GET+POST trên các callback controller như device-callbacks/hb/sf/vf.)
- **Tổng cron job**: 9 (đều trong `src/modules/scheduler/scheduler.service.ts`):
  1. `face-sync` — EVERY_MINUTE (:89)
  2. `face-reconcile` — EVERY_5_MINUTES (:105)
  3. `device-offline-detect` — EVERY_MINUTE (:124)
  4. `no-show-check` — EVERY_5_MINUTES (:138) → UC-41
  5. `auto-release` — EVERY_5_MINUTES (:167) → UC-44
  6. `early-vacancy` — EVERY_5_MINUTES (:190) → UC-46
  7. `ivss-sync` — EVERY_MINUTE (:212)
  8. `notification-reminder` — EVERY_HOUR (:238) → UC-144 (no-op)
  9. `checkin-alert` — EVERY_MINUTE (:253) → UC-92
  - (Ghi chú: `no-show-detection.service.ts:15` chỉ là comment tham chiếu tới cron `no-show-check`, không phải `@Cron` riêng.)

### Bảng module → số route
| Module | Số route |
|---|---:|
| accounts | 31 |
| iot | 29 |
| meetings | 20 |
| recording | 17 |
| rooms | 15 |
| minutes | 13 |
| analytics | 12 |
| anpr | 11 |
| live-meeting | 9 |
| attendance | 8 |
| auth | 6 |
| ivss | 6 |
| transcription | 6 |
| equipment | 5 |
| face-access | 3 |
| scheduling | 3 |
| administration | 2 |
| dev | 2 |
| reports | 2 |
| presence | 1 |
| health | 1 |
| app.controller (root) | 1 |
| **Tổng** | **203** |

### Working tree chưa commit
| File | Loại thay đổi | Liên quan UC? |
|---|---|---|
| .env.example | Modified | Không (config mẫu, không implement UC) |
| scripts/run-seeds.ts | Modified | Không (seed runner, không phải artifact UC) |
| scripts/run-account-seeds.ts | Untracked (mới) | Không trực tiếp (seed tài khoản; hỗ trợ demo UC-05/06 nhưng không phải implementation) |

> Không có file controller/service trong working tree chưa commit — toàn bộ artifact UC đánh giá ở trên đều đã commit trên nhánh `dev`.

---

## 7.7. Re-audit 2026-07-18 (sau khi dev cập nhật, HEAD 5f353d1)

### Phạm vi thay đổi thực tế
Diff `f80d3da..HEAD` chỉ chạm 3 vùng `src/` (đã xác minh bằng `git diff --name-only`):
- `minutes/*` — thêm export PDF/DOCX, share minutes, link external resources, fix attachment access/S3 download.
- `meetings` — thêm endpoint `PATCH/DELETE :meetingId/agendas/:agendaId` (agenda item; UC-28/29 vốn đã DONE qua PUT replace).
- `recording/services/media-files.service.ts` — thêm signed download URL cho media-files detail.

Toàn bộ file behind các UC non-DONE còn lại **KHÔNG đổi** (đã kiểm `git diff --quiet`): scheduler.service.ts, iot-devices.service.ts, iot-device-events.service.ts, room-status.service.ts, equipment.controller.ts, face-attendance.service.ts, meeting-warning.service.ts, recording-session.service.ts, face-profile.service.ts. Không có file mới nào cho recurrence/ad-hoc.

### Kết quả re-audit (25 UC non-DONE lần đầu)
| UC | Lần đầu | Re-audit | Kết luận |
|---|---|---|---|
| UC-139 | PARTIAL | **DONE** | Signed download qua /media-files/:fileId (commit ac17cd7) |
| UC-140 | MISSING | **DONE** | GET /media-files/:fileId trả detail + signed URL |
| UC-141 | PARTIAL | **DONE** | PATCH /meeting-minutes/:id/link-resources ghi linkedRecordingFileId + linkedTranscriptId |
| UC-147 | MISSING | **DONE** | POST /meeting-minutes/:id/exports → worker render PDF/DOCX → media_files |
| UC-136 | MISSING | MISSING | visibilityLevel vẫn chỉ ghi PRIVATE; DTO không expose |
| UC-146 | PARTIAL | PARTIAL | Thêm shareMinutes (cấp quyền đọc) nhưng vẫn không gửi email + không attach/link |
| UC-17, 31, 32, 33, 34, 35, 36, 38, 66, 68, 74, 85, 107, 112, 113, 117, 118, 124, 144 | (như cũ) | KHÔNG ĐỔI | File behind đều unchanged trong diff |

### Delta số liệu
- DONE: 132 → **136** (+4: UC-139, UC-140, UC-141, UC-147)
- PARTIAL: 14 → **12** (−2)
- MISSING: 11 → **9** (−2)
- NOT-A-UC: 1 → **1**

### §7.5 cập nhật (mục đã được xử lý bởi code mới)
- Mục #9 (Export minutes chỉ scaffolding) — ĐÃ XỬ LÝ: pipeline export thực đã có (UC-147).
- Các mục #1-8, #10-17 còn lại trong §7.5 VẪN ĐÚNG (file liên quan không đổi).

---

*Hết báo cáo. Đây là mô tả hiện trạng READ-ONLY; không sửa code, không đề xuất hành động.*
