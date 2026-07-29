# BẢN ĐỒ TÍCH HỢP API FE ↔ BE — 2026-07-26

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo mới: bản đối chiếu toàn bộ route BE (grep controller sống) ↔ lời gọi API FE (grep service sống). 237 route nghiệp vụ, 20 internal, 165 lời gọi FE, 17 lời gọi sai. | Toàn bộ file |

> Nguồn: **100% grep code sống ngày 2026-07-26** — KHÔNG dùng bất kỳ file doc/mapping cũ nào.
> - BE: 78 file `*.controller.ts` trong `capstone-be/src` (`app.setGlobalPrefix('api/v1')` — `src/main.ts:11`).
> - FE: wrapper `FE_SmarTracking/src/utils/request.js` (base `http://localhost:3000/api/v1`, export `get/post/patch/put/dele/request`; `dele` được alias `del` trong anprService), 14 file `src/service/*` + 2 component gọi trực tiếp (`MinutesTabContent.jsx`, `Profile.jsx`) + 1 call cứng trong chính `request.js`.
> - Chuẩn hoá: bỏ prefix `/api/v1`, param → `:x`, bỏ query string, so cả method.

---

## 7.1. TỔNG QUAN

| Chỉ số | Số lượng |
|---|---:|
| Route BE nghiệp vụ (FE có thể gọi) | **237** |
| Route BE internal / device-callback / webhook (FE KHÔNG gọi) | **20** |
| Route BE infra/dev (`GET /`, `GET /health`, `POST /dev/test-mail*`) | 4 |
| Lời gọi API FE (dedup method+path) | **165** |
| **Nhóm 1 — KHỚP** | **148** lời gọi FE ↔ **149** route BE¹ |
| **Nhóm 2 — FE GỌI SAI (404/lỗi)** 🔴 | **17** |
| **Nhóm 3 — BE có, FE chưa dùng** | **85** |
| **Nhóm 4 — Cần xác minh tay** | **0** |
| **% phủ route nghiệp vụ** = 149/237 | **≈ 62,9%** |

¹ 1 lời gọi FE (`GET /meetings/:id/attendance`) khớp đồng thời **2 route BE trùng nhau** — BE khai cùng path ở `live-meeting.controller.ts:458` và `attendance/controllers/attendance.controller.ts:36` (route nào chạy phụ thuộc thứ tự đăng ký module — điểm bất thường BE nên biết).

**2 bất thường BE ảnh hưởng trực tiếp FE:**
1. **5 route trong `meetings.controller.ts` THIẾU prefix `meetings/`** (controller khai `@Controller()` rỗng — dòng 114): `DELETE /:meetingId/participants/:participantUserId` (:795), `GET /:meetingId/agendas` (:924), `PUT /:meetingId/agendas` (:959), `PATCH /:meetingId/agendas/:agendaId` (:1030), `DELETE /:meetingId/agendas/:agendaId` (:1109). Path thật đang chạy là `/api/v1/:meetingId/agendas`, KHÔNG phải `/api/v1/meetings/:meetingId/agendas`.
2. **BE phát `refreshToken` khi login** (`src/modules/auth/services/login.service.ts:123,199`) **nhưng KHÔNG có endpoint `POST /auth/refresh`** — cơ chế token-rotation của FE chết ngay lần 401 đầu tiên (xem Nhóm 2 #1).

---

## 7.2. NHÓM 2 — FE GỌI SAI 🔴 (17 lời gọi — ưu tiên cao nhất)

Phân loại: **(a)** = BE có route đúng, Nam chỉ sửa path/method phía FE. **(b)** = BE chưa có route, BE nợ.

| # | FE gọi | FE `file:dòng` | Màn hình ảnh hưởng | BE đúng là gì | Loại |
|---|---|---|---|---|---|
| 1 | `POST /auth/refresh` | `src/utils/request.js:97` | **MỌI màn hình** — chạy tự động khi access token hết hạn (401) | **BE CHƯA CÓ.** BE có phát refreshToken khi login (`login.service.ts:199`) nhưng `auth.controller.ts` chỉ có login/logout/password-reset/change-password/me | **(b)** |
| 2 | `GET /meetings` (list) | `src/service/businessAdminServices.js:229` | `bussinessAdmin/MeetingManagement.jsx:63`, `bussinessAdmin/RecordingManagement.jsx:65` | **BE CHƯA CÓ** GET list meetings. Gần đúng: `GET /me/schedule` (lịch của tôi, `meetings.controller.ts:735`) — không thay thế được list toàn hệ thống | **(b)** |
| 3 | `PATCH /meetings/:id` | `businessAdminServices.js:237`; `managerServices.js:187`; `employeeServices.js:133` | `bussinessAdmin/MeetingManagement.jsx:148`; `manager/MeetingDetail.jsx:274,344`; `employee/MeetingDetail.jsx:272,342` | BE chỉ có `PATCH /meetings/:id/time` (`meetings.controller.ts:173`, perm `meeting.time.update`) và `PATCH /meetings/:id/room` (:426, perm `meeting.room.update`). Đổi giờ/phòng → **(a)** tách 2 call; đổi title/mô tả/participants qua PATCH → **(b)** BE chưa có | **(a)+(b)** |
| 4 | `PUT /meetings/:id/agendas` | `src/service/employeeServices.js:58` | `employee/BookMeeting.jsx:578` (luồng đặt họp — agenda không lưu được) | BE có route nhưng path thật là `PUT /:meetingId/agendas` (`meetings.controller.ts:959` — thiếu prefix, xem §7.1). Chuẩn: **BE sửa route về `/meetings/:id/agendas`**; workaround tạm: FE gọi `PUT /:id/agendas` | **(b)*** |
| 5 | `POST /live-meetings/:id/extension-requests` | `managerServices.js:301`; `employeeServices.js:227` | Hàm `requestExtension` hiện **chưa màn hình nào gọi** (sẽ 404 khi nối vào InMeetingRoom) | `POST /meetings/:id/extension-requests` (`live-meeting.controller.ts:120`, perm `meeting.extension.request.own`) — BE đặt dưới `meetings/`, không phải `live-meetings/` | **(a)** |
| 6 | `POST /meetings/:id/check-in` | `managerServices.js:201`; `employeeServices.js:147` | Hàm `checkInMeeting` hiện chưa màn hình nào gọi | **BE CHƯA CÓ** self check-in. Gần đúng: `POST /meetings/:id/attendance` (điểm danh thủ công bởi host, `manual-attendance.controller.ts:59`, perm `attendance.manual.create`) — khác nghiệp vụ | **(b)** |
| 7 | `GET /rooms` | `src/service/sysAdminServices.js:349` | `systemAdmin/DeviceManagement.jsx:84` (dropdown chọn phòng khi gán thiết bị) | `GET /rooms/search` (`rooms.controller.ts:60`, JWT) — BE không có `GET /rooms` trần | **(a)** |
| 8 | `GET /rooms/:roomId/devices` | `managerServices.js:333`; `employeeServices.js:259` | Hàm `getRoomDevices` hiện chưa màn hình nào gọi | `GET /iot-devices?roomId=<id>` — query DTO có filter `roomId` (`src/modules/iot/dto/list-iot-devices-query.dto.ts:49`), perm `iot.device.read` | **(a)** |
| 9 | `GET /users/export` | `sysAdminServices.js:328`; `businessAdminServices.js:132` | `bussinessAdmin/UserManagement.jsx` (nút Export) | **BE CHƯA CÓ.** ⚠ Nguy hiểm hơn 404: path này bị **nuốt bởi `GET /users/:userId`** (`users.controller.ts:746`) → lỗi validate userId='export' + đòi perm `account.user.read.detail` | **(b)** |
| 10 | `POST /users/face-profile` | `src/service/employeeServices.js:113` | `employee/FaceRegistration.jsx:155` | `POST /users/:userId/face-profile` (`face-profile.controller.ts:34`) — thiếu `:userId`. Bản manager gọi đúng (`managerServices.js:167`) | **(a)** |
| 11 | `GET /system-configurations` | `src/service/sysAdminServices.js:241` | `systemAdmin/SystemSettings.jsx:47` | **BE CHƯA CÓ** controller system-config nào (module administration chỉ có audit-logs + background-jobs) | **(b)** |
| 12 | `PATCH /system-configurations` | `src/service/sysAdminServices.js:252` | `systemAdmin/SystemSettings.jsx:177,205` | **BE CHƯA CÓ** | **(b)** |
| 13 | `PATCH /departments/:id` | `sysAdminServices.js:285`; `businessAdminServices.js:149` | `bussinessAdmin/DepartmentManagement.jsx:277` | **BE CHƯA CÓ.** `departments.controller.ts` chỉ có `POST` (:43) và `GET` (:105) | **(b)** |
| 14 | `PATCH /notifications/:id/read` | `sysAdminServices.js:366`; `businessAdminServices.js:302` | `systemAdmin/Notifications.jsx` (đánh dấu đã đọc) | **BE CHƯA CÓ.** `notifications.controller.ts` chỉ có GET list (:137) + GET :id (:154) | **(b)** |
| 15 | `PATCH /notifications/read-all` | `sysAdminServices.js:375`; `businessAdminServices.js:311` | `systemAdmin/Notifications.jsx` | **BE CHƯA CÓ** | **(b)** |
| 16 | `PATCH /face-access/stranger-alerts/:id/resolve` | `src/service/businessAdminServices.js:208` | Hàm `resolveStrangerAlert` hiện chưa màn hình nào gọi | **BE CHƯA CÓ.** `stranger-alert.controller.ts` chỉ có GET (:23) | **(b)** |
| 17 | `POST /zones/:id/devices` | `src/service/zoneServices.js:57` | `systemAdmin/ZoneManagement.jsx:158` (gán thiết bị vào zone) | `PATCH /zones/:id/devices` (`zones.controller.ts:113`, perm `zones.zone.assign_device`) — **sai method**, path đúng | **(a)** |

Tóm tắt Nhóm 2: **(a) Nam tự sửa được: 5** (#5, #7, #8, #10, #17) + #3 sửa được một phần. **(b) BE nợ: 11** (#1, #2, #4*, #6, #9, #11–#16) — #4 bản chất là BE sửa 1 dòng route (có workaround FE tạm).

---

## 7.3. NHÓM 3 — BE CÓ, FE CHƯA DÙNG (85 route, nhóm theo module)

### ⭐ Module scope mới (SAVP) — phần Nam phải xây màn hình mới

**Thống kê scope mới:** `zones` 7/7 đã gọi (1 sai method — Nhóm 2 #17) · `gate-access-logs` 0/2 · `anpr` 10/16 · `gate-access` 0/5 · `alerts` 0/15 · `campus-dashboard` 0/3 · `crowd-alert` / `restricted-zone`: **CHƯA TỒN TẠI trong BE** (0 route — grep không ra module nào tên này; nghiệp vụ đám đông/khu cấm hiện nằm trong `alerts`/`campus-dashboard`).

#### alerts — 15 route, FE chưa gọi cái nào (0/15)
| Method | Path | Permission | Route làm gì | BE `file:dòng` |
|---|---|---|---|---|
| GET | `/security-alerts` | `security_alert.read` | List cảnh báo an ninh | `alerts/controllers/alerts.controller.ts:40` |
| GET | `/security-alerts/:id` | `security_alert.read` | Chi tiết cảnh báo | `alerts.controller.ts:53` |
| POST | `/security-alerts/:id/acknowledge` | `security_alert.acknowledge` | Xác nhận đã tiếp nhận | `alerts.controller.ts:68` |
| POST | `/security-alerts/:id/resolve` | `security_alert.resolve` | Đóng cảnh báo | `alerts.controller.ts:82` |
| POST | `/security-alerts/bulk-acknowledge` | `security_alert.acknowledge` | Xác nhận hàng loạt | `alerts.controller.ts:98` |
| POST | `/alert-rules` | `alert_rules.create` | Tạo rule cảnh báo | `alert-rules.controller.ts:41` |
| GET | `/alert-rules` | `alert_rules.read` | List rule | `alert-rules.controller.ts:57` |
| GET | `/alert-rules/:id` | `alert_rules.read` | Chi tiết rule | `alert-rules.controller.ts:70` |
| PATCH | `/alert-rules/:id` | `alert_rules.update` | Sửa rule | `alert-rules.controller.ts:81` |
| DELETE | `/alert-rules/:id` | `alert_rules.delete` | Xoá rule | `alert-rules.controller.ts:97` |
| POST | `/person-control-list` | `person_control_list.create` | Thêm người vào watchlist | `person-control-list.controller.ts:44` |
| GET | `/person-control-list` | `person_control_list.read` | List watchlist người | `person-control-list.controller.ts:60` |
| GET | `/person-control-list/:id` | `person_control_list.read` | Chi tiết | `person-control-list.controller.ts:73` |
| PATCH | `/person-control-list/:id` | `person_control_list.update` | Sửa | `person-control-list.controller.ts:84` |
| DELETE | `/person-control-list/:id` | `person_control_list.delete` | Xoá | `person-control-list.controller.ts:99` |

#### campus-dashboard — 3 route (0/3)
| Method | Path | Permission | Route làm gì | BE `file:dòng` |
|---|---|---|---|---|
| GET | `/campus-dashboard/overview` | `campus_dashboard.overview.read` | Tổng quan khuôn viên | `campus-dashboard/controllers/dashboard-overview.controller.ts:28` |
| GET | `/campus-dashboard/zones/traffic` | `campus_dashboard.traffic.read` | Heatmap lưu lượng theo zone | `zone-traffic-heatmap.controller.ts:26` |
| GET | `/campus-dashboard/zones/:zoneId/timeline` | `campus_dashboard.timeline.read` | Timeline hiện diện 1 zone | `zone-presence-timeline.controller.ts:28` |

#### gate-access — 5 route (0/5)
| Method | Path | Permission | Route làm gì | BE `file:dòng` |
|---|---|---|---|---|
| GET | `/gate-access/history` | JWT (self) | Lịch sử ra-vào của tôi | `gate-access-history.controller.ts:34` |
| GET | `/gate-access/admin/history` | `gate_access.history.read_all` | Lịch sử ra-vào toàn hệ thống | `gate-access-history.controller.ts:53` |
| GET | `/gate-access/history/:id` | JWT (self) | Chi tiết 1 lượt (của tôi) | `gate-access-history.controller.ts:67` |
| GET | `/gate-access/admin/history/:id` | `gate_access.history.read_all` | Chi tiết 1 lượt (admin) | `gate-access-history.controller.ts:84` |
| GET | `/gate-access/admin/vehicle-traffic-stats` | `gate_access.stats.read` | Thống kê lưu lượng xe | `vehicle-traffic-stats.controller.ts:28` |

#### zones (gate-access-logs) — 2 route (0/2)
| Method | Path | Permission | Route làm gì | BE `file:dòng` |
|---|---|---|---|---|
| GET | `/gate-access-logs` | JWT (self) | Log ra-vào cổng của tôi | `zones/controllers/gate-access-log.controller.ts:42` |
| GET | `/admin/gate-access-logs` | `zones.gate_log.read` | Log ra-vào cổng (admin) | `gate-access-log.controller.ts:63` |

#### anpr — 16 route, FE đã gọi 10, chưa gọi 6
| Method | Path | Permission | Route làm gì | BE `file:dòng` |
|---|---|---|---|---|
| GET | `/anpr/admin/vehicle-registrations` | `anpr.vehicle.admin_read` | Admin list toàn bộ xe đăng ký | `vehicle-registration.controller.ts:114` |
| POST | `/anpr/admin/control-list` | `vehicle_control.create` | Thêm biển số blocklist/watchlist | `vehicle-control-list.controller.ts:45` |
| GET | `/anpr/admin/control-list` | `vehicle_control.read` | List control-list | `vehicle-control-list.controller.ts:64` |
| GET | `/anpr/admin/control-list/:id` | `vehicle_control.read` | Chi tiết | `vehicle-control-list.controller.ts:77` |
| PATCH | `/anpr/admin/control-list/:id` | `vehicle_control.update` | Sửa | `vehicle-control-list.controller.ts:88` |
| DELETE | `/anpr/admin/control-list/:id` | `vehicle_control.delete` | Xoá | `vehicle-control-list.controller.ts:103` |

#### iot (phần ai-config / vận hành) — 3 route chưa dùng (11/14 đã dùng)
| Method | Path | Permission | Route làm gì | BE `file:dòng` |
|---|---|---|---|---|
| GET | `/iot-devices/status-summary` | `iot.device.read` | Tổng hợp trạng thái thiết bị (dashboard) | `iot-devices.controller.ts:54` |
| POST | `/iot-devices/probe-status` | `iot.device.probe` | Probe trạng thái thiết bị | `iot-devices.controller.ts:109` |
| PATCH | `/iot-devices/:id/ai-config` | `iot.device.configure_ai` | Cấu hình AI cho camera (SAVP) | `iot-devices.controller.ts:211` |

### Module core còn thiếu FE

#### meetings — 12 route chưa dùng
| Method | Path | Permission | Route làm gì | BE `file:dòng` |
|---|---|---|---|---|
| PATCH | `/meetings/:meetingId/time` | `meeting.time.update` | Đổi giờ họp (thay cho PATCH /meetings/:id — Nhóm 2 #3) | `meetings.controller.ts:173` |
| GET | `/meetings/:meetingId/available-rooms` | JWT | Phòng khả dụng cho meeting đang sửa | `meetings.controller.ts:253` |
| GET | `/meetings/:meetingId/participants/import/template` | `meeting.participant.import` | Template import participant | `meetings.controller.ts:341` |
| POST | `/meetings/:meetingId/participants/import` | `meeting.participant.import` | Import participant từ file | `meetings.controller.ts:365` |
| PATCH | `/meetings/:meetingId/room` | `meeting.room.update` | Đổi phòng họp | `meetings.controller.ts:426` |
| GET | `/me/schedule/:meetingId` | `schedule.read.self` | Chi tiết 1 mục lịch của tôi | `meetings.controller.ts:764` |
| DELETE | `/:meetingId/participants/:participantUserId` ⚠ thiếu prefix | JWT | Gỡ participant nội bộ | `meetings.controller.ts:795` |
| POST | `/meetings/:meetingId/participants/external` | `meeting.participant.add.external` | Thêm khách ngoài | `meetings.controller.ts:848` |
| DELETE | `/meetings/:meetingId/participants/external/:externalParticipantId` | JWT | Gỡ khách ngoài | `meetings.controller.ts:884` |
| GET | `/:meetingId/agendas` ⚠ thiếu prefix | JWT | Xem agenda | `meetings.controller.ts:924` |
| PATCH | `/:meetingId/agendas/:agendaId` ⚠ thiếu prefix | JWT | Sửa 1 agenda item | `meetings.controller.ts:1030` |
| DELETE | `/:meetingId/agendas/:agendaId` ⚠ thiếu prefix | JWT | Xoá 1 agenda item | `meetings.controller.ts:1109` |

#### minutes — 9 route chưa dùng (biên bản: share/export/attachment)
| Method | Path | Permission | BE `file:dòng` |
|---|---|---|---|
| GET | `/meeting-minutes/search-by-person` | `meeting.minutes.search_by_person` | `minutes-list.controller.ts:133` |
| PATCH | `/meeting-minutes/:id/link-resources` | `meeting.minutes.link_resources` | `minutes-list.controller.ts:344` |
| POST | `/meeting-minutes/:id/shares` | `meeting.minutes.share.create` | `minutes-list.controller.ts:400` |
| GET | `/meeting-minutes/:id/shares` | `meeting.minutes.share.read` | `minutes-list.controller.ts:449` |
| DELETE | `/meeting-minutes/:id/shares/:userId` | `meeting.minutes.share.delete` | `minutes-list.controller.ts:484` |
| POST | `/meeting-minutes/:id/exports` | `meeting.minutes.export` | `minutes-list.controller.ts:525` |
| POST | `/meeting-minutes/:minutesId/attachments` | `meeting.minutes.attachment.create` | `minutes-list.controller.ts:567` |
| GET | `/meeting-minutes/:minutesId/attachments` | `meeting.minutes.attachment.read` | `minutes-list.controller.ts:635` |
| DELETE | `/meeting-minutes/:minutesId/attachments/:fileId` | `meeting.minutes.attachment.delete` | `minutes-list.controller.ts:680` |

#### rooms + cấu hình phòng — 8 route chưa dùng
| Method | Path | Permission | BE `file:dòng` |
|---|---|---|---|
| GET | `/rooms/:roomId/deletion-impact` | `room.delete` | `rooms.controller.ts:177` |
| GET | `/rooms/realtime-status` | `room.utilization.read` | `rooms.controller.ts:238` — ⚠ FE có hàm tên `getRoomRealtimeStatus` nhưng lại gọi `/rooms/search` (`businessAdminServices.js:171-172`) |
| GET | `/rooms/:roomId/status` | `room.utilization.read` | `rooms.controller.ts:253` |
| GET | `/room-bookings` | `room.booking.read` | `room-bookings.controller.ts:39` |
| GET | `/no-show-config` | `room.noshow.configure` | `no-show-config.controller.ts:27` |
| PUT | `/no-show-config` | `room.noshow.configure` | `no-show-config.controller.ts:35` |
| GET | `/early-vacancy-config` | `room.early_vacancy.configure` | `early-vacancy-config.controller.ts:29` |
| PUT | `/early-vacancy-config` | `room.early_vacancy.configure` | `early-vacancy-config.controller.ts:37` |

#### notifications — 5 route chưa dùng
| Method | Path | Permission | BE `file:dòng` |
|---|---|---|---|
| POST | `/meetings/:meetingId/invitations` | `notification.invite.send` | `notifications.controller.ts:55` |
| POST | `/meetings/:meetingId/reminders` | `notification.reminder.send` | `notifications.controller.ts:75` |
| POST | `/meetings/:meetingId/cancellation-notifications` | `notification.cancellation.send` | `notifications.controller.ts:95` |
| POST | `/meetings/:meetingId/minutes/distributions` | `minutes.distribute` | `notifications.controller.ts:116` |
| GET | `/notifications/:id` | `notification.read.self` | `notifications.controller.ts:154` |

#### reports — 4 route chưa dùng (FE mới dùng meeting-activity)
| Method | Path | Permission | BE `file:dòng` |
|---|---|---|---|
| POST | `/reports/room-utilization/exports` | `report.room_utilization.export` | `room-utilization-report.controller.ts:38` |
| POST | `/reports/gate-access/exports` | `report.gate_access.export` | `gate-access-report.controller.ts:31` ⭐ SAVP |
| POST | `/reports/security-alert/exports` | `report.security_alert.export` | `security-alert-report.controller.ts:31` ⭐ SAVP |
| POST | `/reports/vehicle/exports` | `report.vehicle.export` | `vehicle-report.controller.ts:29` ⭐ SAVP |

#### analytics — 3 · ivss — 3 · recording — 2 · media — 1 · khác — 4
| Method | Path | Permission | BE `file:dòng` |
|---|---|---|---|
| GET | `/analytics/rooms/usage-history` | `analytics.room.read` | `room-usage-history.controller.ts:42` |
| GET | `/analytics/rooms/:roomId/detail` | `analytics.room.read` | `room-usage-dashboard.controller.ts:91` |
| GET | `/analytics/attendance/on-time-rate/users/:userId/late-history` | `analytics.attendance.read` | `on-time-rate.controller.ts:94` |
| GET | `/ivss/meetings/:meetingId/presence/:userId` | `ivss.presence.read` | `ivss-presence.controller.ts:29` |
| GET | `/ivss/meetings/:meetingId/presence/report` | `ivss.presence.read` | `ivss-presence.controller.ts:65` |
| GET | `/ivss/health` | `ivss.health.read` | `ivss-health.controller.ts:19` |
| POST | `/meetings/:meetingId/recording-sessions` | `transcript.create` | `recording-session.controller.ts:156` |
| POST | `/meetings/:meetingId/recording-sessions/:sessionId/audio-tracks` | `recording.upload_track` | `recording-session.controller.ts:205` |
| GET | `/media-files/:fileId` | `recording.files.read` | `media-files.controller.ts:53` |
| GET | `/users/manage` | `accounts.user.manage` | `users.controller.ts:693` |
| DELETE | `/roles/:roleId/permissions/:permissionId` | `admin.manage_permissions` | `role-permissions.controller.ts:70` |
| GET | `/meetings/:meetingId/attendance/:recordId` | `attendance.read` | `attendance.controller.ts:81` |
| GET | `/meetings/:meetingId/timeline` | `meeting.timeline.read` | `live-meeting.controller.ts:733` |

**Đếm Nhóm 3:** alerts 15 + campus-dashboard 3 + gate-access 5 + gate-access-logs 2 + anpr 6 + iot 3 + meetings 12 + minutes 9 + rooms/config 8 + notifications 5 + reports 4 + analytics 3 + ivss 3 + recording 2 + media 1 + users/roles 2 + attendance 1 + live-meeting 1 = **85** ✔

---

## 7.4. NHÓM 1 — KHỚP (148 lời gọi, liệt kê gọn theo module)

**auth (6):** POST `/auth/login`, POST `/auth/logout`, POST `/auth/password-reset/request`, POST `/auth/password-reset/confirm`, PATCH `/auth/change-password`, GET `/auth/me` — `authService.js:10-65` ↔ `auth.controller.ts:53,91,136,168,199,253`.

**analytics (9):** GET `/analytics/dashboard/overview` (`analytics.overview.read`), `/analytics/rooms/dashboard`, `/analytics/rooms/utilization-rate`, `/analytics/rooms/no-show-rate` (`analytics.room.read`), `/analytics/attendance/on-time-rate` (`analytics.attendance.read`), `/analytics/meetings/count-by-period|status-breakdown|average-duration|cancel-rate` (`analytics.meeting.read`) — `sysAdminServices.js:12-42`, `businessAdminServices.js:9-54`, `managerServices.js:13-73`.

**users/accounts (12):** GET `/users` (`accounts.user.list`), GET `/users/:userId` (`account.user.read.detail`) (`Profile.jsx:80`), POST `/users` (create), PATCH `/users/:userId` (update), PUT `/users/:userId/roles`, PATCH `/users/:userId/status|lock|unlock`, DELETE `/users/:userId`, POST `/users/import` + GET `/users/import/template` (`accounts.user.import`), GET `/users/:userId/public-profile` (JWT) — `sysAdminServices.js:56-169`, `businessAdminServices.js:67-127`, `employeeServices.js:92`.

**roles & permissions (12):** GET/POST `/roles`, GET/PATCH/DELETE `/roles/:id` (`account.role.*`); GET/POST `/permissions`, GET/PATCH `/permissions/:id`, POST `/permissions/:id/toggle-active` (`admin.manage_permissions`); GET/POST `/roles/:roleId/permissions` — `permissionServices.js:7-61`.

**departments (2):** GET `/departments` (`department.read`), POST `/departments` (`department.create`) — `sysAdminServices.js:266,275`.

**audit & jobs (2):** GET `/audit-logs` (`audit.system.read`) — `sysAdminServices.js:151`; GET `/background-jobs/:id` (JWT) — `sysAdminServices.js:318`, `minutesServices.js:75`.

**iot-devices (11):** GET `/iot-devices`, GET `/iot-devices/:id` (`iot.device.read`), POST `/iot-devices` (`iot_devices:create`), PATCH `/iot-devices/:id` (`iot.device.update`), POST `:id/assign-room`, PATCH `:id/rtsp-config`, POST `:id/face-server/rotate|revoke`, POST `:id/disable|enable|check-availability` — `sysAdminServices.js:183-408` ↔ `iot-devices.controller.ts:37-334`.

**face-access (3):** GET `/face-access/unmapped-verifies` (`face.unmapped.read`), POST `/face-access/unmapped-verifies/map` (`face.unmapped.map`) — `sysAdminServices.js:421,429`; GET `/face-access/stranger-alerts` (`face.stranger.read`) — `businessAdminServices.js:202`.

**rooms (4):** GET `/rooms/search` (JWT) — `businessAdminServices.js:172`; GET `/rooms/available` (JWT, `meetings.controller.ts:558`) — `employeeServices.js:13`; POST `/rooms` (`room.create`), PATCH `/rooms/:roomId` (`room.update`), DELETE `/rooms/:roomId` (`room.delete`) — `businessAdminServices.js:212-220`. *(5 dòng — POST/PATCH/DELETE + 2 GET)*

**no-show (3):** GET `/no-show-cases` (`room.noshow.read`), PATCH `/no-show-cases/:id` (`room.noshow.update`), POST `/no-show-cases/:id/release` (`room.noshow.release`) — `businessAdminServices.js:180-193`, `managerServices.js:338`.

**notifications (1):** GET `/notifications` (`notification.read.self`) — `sysAdminServices.js:357`.

**meetings (10):** POST `/meetings` (`meeting.create`), GET `/meetings/:id` (JWT), POST `/meetings/:id/cancel` (`meeting.cancel.own`), POST `/meetings/:id/participants/internal` (`meeting.participant.add.internal`), GET `/me/schedule` (`schedule.read.self`), GET `/meeting-requests` (`meeting_request.read`), POST `/meeting-requests/:id/approve|reject` (`meeting_request.approve|reject`), GET `/scheduling/room-suggestions` + POST `/scheduling/participant-conflicts/check` + POST `/scheduling/time-suggestions` (`scheduling.*`) — `employeeServices.js:40,67,76,122,140`, `managerServices.js:100-116`, `schedulingServices.js:10-28`. *(meetings 7 + scheduling 3)*

**attendance (5):** GET `/meetings/:id/attendance` (`attendance.read`)¹, POST `/meetings/:id/attendance` (`attendance.manual.create`), PATCH `.../:recordId/status`, PATCH `.../:recordId` (`attendance.manual.update`), POST `.../:recordId/invalidate` (`attendance.invalidate`) — `managerServices.js:268-284`, `employeeServices.js:182-193`.

**live-meeting (7):** POST `/live-meetings/:id/start` (`meeting.session.start`), POST `/live-meetings/:id/end` (`meeting.session.end`), GET `/live-meetings/:id/present-attendees` (`meeting.presence.read`), POST `/live-meetings/:id/extension-requests/:requestId/decide` (perm rỗng — service tự check), GET+POST `/meetings/:id/notes` (`meeting.note.read|create`), GET `/ivss/meetings/:id/presence` (`ivss.presence.read`) — `managerServices.js:180-309`, `employeeServices.js:155-235`.

**recording & media (13):** POST `/live-meetings/:id/recording/start-video` (`recording.video.start`), POST `.../:sessionId/stop-video|pause-video|resume-video` (`recording.video.stop`), GET `.../:sessionId/status` (`recording.video.status`), GET `/meetings/:id/recording-sessions` (`transcript.read`), POST `/meetings/:id/recording-sessions/audio-upload` (`transcript.create`), POST/GET/PATCH `/meetings/:id/recording-config` (`recording.config.*`), GET `/meetings/:id/media-files` (`recording.files.read`), GET `/media-files/:fileId/playback` (`recording.files.play`), GET `/media-files/:fileId/secure-download` (`recording.files.read`), PATCH `/media-files/:fileId/visibility` (`recording.files.manage`) — `managerServices.js:317-354`, `employeeServices.js:243-275`, `transcriptionServices.js:11`, `businessAdminServices.js:256-284`. *(14 dòng)*

**transcription (6):** POST+GET `/meetings/:id/transcription-jobs` (`transcript.create|read`), GET `/meetings/:id/transcript` (`transcript.read`), PATCH `/transcripts/:id/segments|content|status` (`transcript.update`) — `transcriptionServices.js:20-69`, `MinutesTabContent.jsx:104`.

**minutes (9):** POST `/meetings/:id/minutes` (`meeting.minutes.create`), GET `/meetings/:id/minutes/ai-draft-config` (JWT), POST+GET `/meetings/:id/minutes/ai-draft-jobs`, GET `/meeting-minutes` (`meeting.minutes.read`) (`MinutesTabContent.jsx:51`), GET/PATCH/DELETE `/meeting-minutes/:id`, POST `/meeting-minutes/:id/issue` (`meeting.minutes.issue`) — `minutesServices.js:8-67`.

**reports (1):** POST `/reports/meeting-activity/exports` (`report.meeting_activity.export`) — `businessAdminServices.js:58`, `managerServices.js:123`.

**equipment (5):** GET/POST `/equipments`, PATCH `/equipments/:id/fault`, PATCH `/equipments/:id/assignment`, DELETE `/equipments/:id` (`equipment.*`) — `equipmentServices.js:10-49`.

**avatar (7):** GET `/me/avatar-status` (`profile.avatar.read_status`), POST `/me/avatar-submission` (`profile.avatar.submit`) — `avatarService.js:4,15`; GET `/admin/avatar-submissions`, GET `:faceProfileId`, GET `:faceProfileId/download-url` (`account.avatar.download`), POST `:faceProfileId/approve|reject` (`account.avatar.review`) — `avatarReviewService.js:9-22`.

**face-profile (1):** POST `/users/:userId/face-profile` (JWT+MockPermissionsGuard) — `managerServices.js:167` ↔ `face-profile.controller.ts:34`.

**zones ⭐ (6):** GET `/zones`, GET `/zones/:id` (`zones.zone.read`), POST `/zones` (`zones.zone.create`), PATCH `/zones/:id` (`zones.zone.update`), DELETE `/zones/:id` (`zones.zone.delete`), DELETE `/zones/:id/devices/:deviceId` (`zones.zone.assign_device`) — `zoneServices.js:10-67` ↔ `zones.controller.ts:56-192`.

**anpr ⭐ (10):** GET `/anpr/vehicle-registrations`, GET/PATCH/DELETE `/anpr/vehicle-registrations/:id`, PATCH `:id/status`, POST `/anpr/vehicle-registrations` (JWT); POST `/anpr/admin/vehicle-registrations` (`anpr.vehicle.admin_register`); GET `/anpr/vehicle-history` (JWT); GET `/anpr/admin/vehicle-history` (`anpr.vehicle.history_view`); GET `/anpr/admin/unknown-vehicles` (`anpr.vehicle.unknown_view`) — `anprService.js:13-92` ↔ `vehicle-registration.controller.ts:57-252`.

---

## 7.5. NHÓM 4 + NGUỒN GÂY SAI

**Nhóm 4 — cần xác minh tay: 0.** Mọi path FE đều là template literal chuẩn hoá được; method đều tường minh (kể cả `request(..., {method:'PUT'})` ở `sysAdminServices.js:94`).

**2 điểm lưu ý vận hành (không phải mismatch):**
1. `GET /meetings/:id/attendance` trùng khai ở 2 controller BE (xem chú thích §7.1) — hành vi phụ thuộc thứ tự module trong `app.module.ts`.
2. Hàm FE `getRoomRealtimeStatus` (`businessAdminServices.js:171`) thực chất gọi `/rooms/search` — tên hàm gây hiểu nhầm; route `/rooms/realtime-status` thật của BE chưa được dùng.

**File doc trong FE (`src/docs/`) — KHÔNG được dùng làm nguồn endpoint (nhiều file đã lỗi thời, là nguồn gốc các lời gọi sai):**
`API_GUIDE_FE.md`, `API_TO_SCREEN_MAPPING.md`, `UC_API_DB_Mapping_Master.md`, `FE-SPEC-camera-screens (1).md`, `FE_PLAN_Camera_Endpoints.md`, `FE_PLAN_Camera_Integration.md`, `FE_PLAN_Camera_Fixes.md`, `stt-feature-status-cho-fe.md`, `FE_RULES_SMARTRACKING.md`, `AGENTS.md`; thư mục `_archive/`: `API_CONTRACT_v1.0_with_system_roles.md`, `API_REQUIREMENTS_FOR_FE.md`, `PLAN_SYNC_FE_CHANGES_2026-06-24.md`, `FRONTEND_CHANGES_REPORT.md`, `UC_FULL_289_MAPPING_AI.md`, `Copy Uc.md`, `spec.md`. (Các match grep trong các file này đã bị LOẠI khỏi thống kê lời gọi.)

**Route internal / device / webhook — 20 route, FE KHÔNG gọi (không tính Nhóm 3):**
- `POST /internal/ivss/events` (`IvssInternalTokenGuard`, `ivss-webhook.controller.ts:32`), `POST /internal/ivss/occupancy-events` (`ivss-occupancy.controller.ts:30`), `POST /internal/ivss/vehicle-events` (`AnprInternalTokenGuard`, `vehicle-webhook.controller.ts:37`)
- `POST /internal/meetings/:meetingId/late-checkin-alerts` (`InternalApiGuard`, `checkin-alert.controller.ts:19`), `POST /internal/no-show-cases` (`InternalTokenGuard`, `no-show.controller.ts:37`)
- Device callbacks: `GET|POST /device-callbacks/face/heartbeat|verify|stranger` (6, `device-callbacks.controller.ts:9-37`); `GET|POST /hb` + `GET|POST /hb/:deviceCode/:callbackToken` (4, `short-device-callbacks.controller.ts`); `GET|POST /sf/:deviceCode/:callbackToken` (2); `GET|POST /vf/:deviceCode/:callbackToken` (2)
- `POST /room-camera/occupancy-snapshots` (từ Python Camera Service, `room-camera.controller.ts:16`)

**Infra/dev (4, không tính nghiệp vụ):** `GET /` (`app.controller.ts:8`), `GET /health` (`health.controller.ts:60`), `POST /dev/test-mail`, `POST /dev/test-mail-verify` (`dev.controller.ts:30,60`).

---

## 7.6. ĐỐI SOÁT TỔNG — chứng minh không sót

**Phía BE:** 237 route nghiệp vụ = **149** (Nhóm 1, gồm 1 route trùng attendance) + **85** (Nhóm 3) + **3** (route là "đích đúng" của Nhóm 2 loại-a mà FE chưa gọi đúng: `PUT /:meetingId/agendas`, `PATCH /zones/:id/devices`, `POST /meetings/:id/extension-requests`). → 149+85+3 = **237 ✔ CÂN**.
(Các đích (a) còn lại — `GET /rooms/search`, `GET /iot-devices`, `POST /users/:userId/face-profile` — đã nằm trong Nhóm 1 vì có lời gọi FE đúng khác, không đếm trùng.)
Ngoài nghiệp vụ: 20 internal + 4 infra/dev. Tổng decorator route đã quét toàn bộ 78 controller.

**Phía FE:** 165 lời gọi (dedup) = **148** (Nhóm 1) + **17** (Nhóm 2) + **0** (Nhóm 4) = **165 ✔ CÂN**.
Chống sót FE: (1) grep mọi call-with-string-literal của `get/post/patch/put/dele/del/request` trên toàn `src/`; (2) đối chiếu ngược 19 file import wrapper — 2 file ngoài danh sách call (`login.jsx`, `ProtectedRoute.jsx`) chỉ dùng token helper, không gọi API; (3) không có axios, `fetch()` chỉ xuất hiện trong `request.js`; (4) mọi match trong `src/docs/**` bị loại.

**Lưu ý phủ Nhóm 2:** 5 lời gọi sai nằm trong hàm service **chưa được màn hình nào import** (`checkInMeeting`, `requestExtension` [bản create], `getRoomDevices`, `resolveStrangerAlert`) — chưa nổ 404 hôm nay nhưng sẽ nổ ngay khi Nam nối màn hình; vẫn tính đủ vào 17.

---

## 7.7. ĐỀ XUẤT THỨ TỰ CHO NAM

1. **Sửa ngay 5 mismatch loại (a)** — chặn 404 đang hiện hữu: `POST→PATCH /zones/:id/devices` (ZoneManagement), `GET /rooms→/rooms/search` (DeviceManagement), `POST /users/face-profile→/users/:userId/face-profile` (FaceRegistration employee), `POST /live-meetings/:id/extension-requests→/meetings/:id/extension-requests`, `GET /rooms/:id/devices→GET /iot-devices?roomId=`. Kèm: tách `PATCH /meetings/:id` thành `/time` + `/room` cho phần đổi giờ/phòng.
2. **Chốt với BE (Hải/Tài) 11 khoản nợ (b)** — quan trọng nhất: `POST /auth/refresh` (đang làm chết token rotation toàn app), `GET /meetings` (MeetingManagement + RecordingManagement đang trắng), sửa 5 route thiếu prefix `meetings/` (agendas/participants), notifications read/read-all, system-configurations, PATCH departments, users/export.
3. **Xây màn hình scope mới theo đòn bẩy:** (i) Security Alerts + Alert Rules + Person Control List (15 route, trung tâm cảnh báo UC-113/114/116); (ii) Campus Dashboard (3 route); (iii) Gate Access History + vehicle-traffic-stats (5) + gate-access-logs (2); (iv) ANPR control-list admin (5) + admin/vehicle-registrations (1); (v) 3 route báo cáo SAVP exports.
4. **Phần còn lại theo nhu cầu:** minutes share/export/attachment (9), notifications gửi chủ động (4), room-bookings/no-show-config/early-vacancy (7), analytics chi tiết (3), iot status-summary/probe/ai-config (3), participants external/import (4).

---

## 9. XÁC NHẬN CUỐI

1. ✅ Đã grep controller BE thật — **78 file controller**, không dùng bất kỳ doc/mapping cũ nào.
2. ✅ Đã grep FE thật — **14 file service + request.js + 19 file import wrapper** (2 file chỉ dùng token helper), loại toàn bộ `src/docs/**`.
3. ✅ Đối soát §7.6 **CÂN cả hai phía** (BE 149+85+3=237; FE 148+17+0=165).
4. ✅ Không sửa/tạo/xoá/commit file nào ở cả hai repo, ngoại trừ đúng 1 file output này (`capstone-be/docs/FE_BE_API_MAP_2026-07-26.md`).
5. ✅ Mọi con số lấy từ code sống ngày 2026-07-26, mọi kết luận kèm `path:dòng` hai đầu.
