# CDB-RS-001 — (Không có UC gốc SRS) Zones/Campus-dashboard: Tổng hợp dashboard theo vai trò (Manager/Employee/Business-admin Summary)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-29 | Tạo spec CDB-RS-001. Nguồn gốc: KHÔNG có UC riêng trong SRS/API Contract chính thức — phát sinh từ `Plan.md` (gốc dự án SmarTracking) mục 2.A, được audit lại với code thật và chốt qua AskUserQuestion trong phiên làm việc với Thiếu Chủ. 3 endpoint: `GET /campus-dashboard/manager-summary`, `GET /campus-dashboard/employee-summary`, `GET /campus-dashboard/business-admin-summary`. Gộp CHUNG 1 feature (mirror cách `uc123-alert-center` gộp 5 endpoint) vì cùng module `campus-dashboard`, cùng đợt code, phục vụ 3 role riêng biệt của cùng 1 nhu cầu "trang chủ theo vai trò". | Toàn bộ |

> Nguồn gốc: xem `Plan.md` (root repo, ngoài `capstone-be`) mục 2.A — bản kế hoạch BE cho scope Campus Tracking, đã audit lại nhiều lần với code thật (07-29). Tạm đặt mã **CDB-RS-001**, chờ Product Owner gán số UC chính thức nếu cần đưa vào Feature Table (mirror cách `spec/features/notifications/feat-notification-inbox/spec.md` xử lý case "không có UC gốc").
>
> **Phụ thuộc**: module `campus-dashboard` đã tồn tại (scaffold từ CDB-001/UC-126, xem [../uc126-campus-dashboard/](../uc126-campus-dashboard/)) — feature này CHỈ thêm 3 controller/service/dto mới vào module đã có, mirror đúng cách UC-119/UC-120 đã làm. KHÔNG tạo module riêng.
>
> **Phạm vi đã bị cắt so với `Plan.md` gốc** (quyết định qua AskUserQuestion, phiên 2026-07-29):
> 1. **`GET /notifications/unified-feed` (mục 2.B Plan.md) — BỎ HẲN, không nằm trong feature này.** Lý do: `spec/features/notifications/feat-notification-inbox/` (đã code, BE-07) và `spec/features/alerts/uc123-alert-center/` (đã code) đã cung cấp 2 API đọc riêng biệt đủ dùng; FE tự gọi cả hai thay vì BE dựng thêm 1 tầng gộp. Tránh lệch dữ liệu giữa tầng gộp và 2 nguồn gốc, tránh phải sửa `NotificationReadStateService` (hiện hard-code theo `notificationId`, không generic `source_type:source_id`) — đúng tinh thần "không over-engineering" của CLAUDE.md mục 33.
> 2. **Module `gate-access`/`anpr` — ngoài phạm vi**, do thành viên khác trong nhóm phụ trách (xem `Plan.md` mục "Scope điều chỉnh 2026-07-29"). `employee-summary` CHỈ đọc (SELECT) read-only từ `vehicle_registrations`/`gate_access_logs`, KHÔNG sửa/thêm gì trong 2 module đó.
>
> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md trước khi cho phép code.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Module `campus-dashboard` đã tồn tại đầy đủ (KHÔNG phải chỉ có spec như nhầm tưởng ban đầu)
`src/modules/campus-dashboard/` đã code xong 3 cụm (CDB-001/UC-126 overview, UC-119 timeline, UC-120 traffic): `campus-dashboard.module.ts`, `controllers/{dashboard-overview,zone-presence-timeline,zone-traffic-heatmap}.controller.ts`, `services/{dashboard-overview,zone-presence-timeline,zone-traffic-heatmap}.service.ts`, `repositories/campus-dashboard.repository.ts`, `utils/{resolve-camera-status,resolve-occupancy-status}.util.ts`. Permission đã seed: `campus_dashboard.overview.read`/`.timeline.read`/`.traffic.read` — cả 3 đã gán **SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER** (KHÔNG EMPLOYEE) — migration `20260723000008-010`. Route thật: `GET /campus-dashboard/overview`, `GET /campus-dashboard/zones/:zoneId/timeline`, `GET /campus-dashboard/zones/traffic` — KHÁC path đoán ban đầu trong `Plan.md` gốc.

### 0.2. `CampusDashboardRepository` đã có method dùng chung — TÁI DÙNG, không viết trùng
`loadZoneHierarchy(filter)`, `loadLatestCountEvent(zoneId)` (per-zone, `ZonePresenceEventEntity` `eventType='count'` mới nhất, dùng `IDX_zpe_count`), `loadDevicesByZone(zoneIds)`, `countGateLogsToday(zoneId, direction, startOfDay)`, `loadStalenessMinutes()` (đọc `system_configs`, fallback 15 phút). **3 endpoint mới ở đây CẦN method TỔNG HỢP TOÀN BỘ zone** (không phải per-zone như UC-126) — ví dụ `sumOccupancyAllZones()`, `countGateLogsAllZonesToday()` — method mới, KHÔNG có sẵn, thêm vào cùng file `campus-dashboard.repository.ts` (không tạo repository riêng, mirror nguyên tắc "dùng chung" của CDB-001 plan §4).

### 0.3. `users.direct_manager_id`/`department_id` ([user.entity.ts](../../../../src/modules/accounts/entities/user.entity.ts) dòng ~64-68)
Xác nhận lại: có sẵn, dùng cho "team của manager" = `users WHERE direct_manager_id = :managerId`.

### 0.4. Pattern lọc "meeting_requests đang chờ MANAGER cụ thể duyệt" — đã có sẵn, TÁI DÙNG nguyên logic
[`meetings.service.ts`](../../../../src/modules/meetings/services/meetings.service.ts) dòng 5245-5253 (`listPending`), khi user KHÔNG phải `SYSTEM_ADMIN`/`BUSINESS_ADMIN`, filter:
```sql
approval_status = 'pending' AND (
  requester.direct_manager_id = :userId
  OR requester.department_id IN (
    SELECT d.id FROM departments d WHERE d.manager_user_id = :userId
  )
)
```
`meeting_requests.approvalStatus` dùng enum `ApprovalStatus` thật: `pending/approved/rejected/applied/cancelled` (KHÔNG có chuỗi `'pending_approval'` — chuỗi đó thuộc enum `MeetingStatus` của bảng `meetings` khác, xem [meeting-request.entity.ts](../../../../src/modules/meetings/entities/meeting-request.entity.ts) dòng 27-33). `manager-summary` PHẢI dùng đúng điều kiện 2 nhánh này (direct report + department mà manager là trưởng phòng), KHÔNG chỉ lọc `direct_manager_id` đơn giản như `Plan.md` gốc viết — tránh thiếu sót so với logic đã duyệt/code sẵn ở module `meetings`.

### 0.5. `security_alerts` — đủ field cho business-admin-summary, KHÔNG cần bảng mới
[security-alert.entity.ts](../../../../src/modules/alerts/entities/security-alert.entity.ts): `severity` (`low/medium/high/critical`, xem bảng mapping tĩnh ở [uc123-alert-center/spec.md](../../alerts/uc123-alert-center/spec.md) §2.2), `status` (`new/acknowledged/resolved`), `zoneId`, `alertType`, `triggeredAt`. **"ANPR blocklist hit hôm nay"** = `security_alerts WHERE alertType='vehicle_control_match' AND triggeredAt >= startOfDay` — xác nhận qua [vehicle-control-alert.service.ts](../../../../src/modules/anpr/services/vehicle-control-alert.service.ts) dòng 50-176: mọi lượt khớp blocklist/watchlist đều ghi qua `AlertsService.recordAlert()` với `alertType='vehicle_control_match'`, KHÔNG có bảng log riêng nào khác cho "lượt quét khớp blocklist". **KHÔNG cần đọc `anpr`/`gate-access` trực tiếp cho số liệu này** — chỉ cần đọc `security_alerts` (module `alerts`, không nằm trong phạm vi bị chặn "gate-access/anpr").

### 0.6. `zone_presence_events` — occupancy toàn khuôn viên = SUM occupancy mới nhất mỗi zone
Không có sẵn 1 cột "tổng occupancy toàn trường" — phải lấy occupancy mới nhất (`eventType='count'`) của TỪNG zone rồi SUM, cùng thuật toán "no_data" như CDB-001 §2.3 (zone không có dữ liệu tin cậy thì loại khỏi tổng, không tính là 0) — xem quyết định §2.3 bên dưới.

### 0.7. Định nghĩa "on-time" đã tồn tại sẵn trong module `analytics` — PHẢI tái dùng cùng ngưỡng, KHÔNG tự chế định nghĩa khác
[`on-time-rate.service.ts`](../../../../src/modules/analytics/services/on-time-rate.service.ts): "on-time" = check-in (`attendance_records`) trong vòng `graceMinutes` (query param, client truyền, mặc định `0`) sau giờ bắt đầu meeting; `onTimeRate = onTimeCount / totalRequiredParticipants * 100`. Endpoint `GET /analytics/on-time-rate` (`analytics.attendance.read`) filter theo **department**, KHÔNG filter theo `direct_manager_id`/team — **không tái dùng được trực tiếp** (khác chiều scope), nhưng **PHẢI dùng chung định nghĩa "on-time"** (check-in trong X phút sau giờ bắt đầu) để tránh 2 định nghĩa "đúng giờ" khác nhau trong cùng hệ thống — xem quyết định §2.5.

### 0.8. `vehicle_registrations.status` — CHỈ có `active|disabled`, KHÔNG có `pending/approved/rejected`
Đã xác nhận trước đó (không lặp lại RECON đầy đủ ở đây) — `employee-summary` CHỈ hiển thị literal `status` hiện có (`active`/`disabled`), KHÔNG chờ cột `approval_status` (thuộc phần bàn giao module `anpr` cho thành viên khác, xem `Plan.md` mục 2.D đã BỎ QUA).

### 0.9. Permission pattern — mirror `zones.controller.ts` dòng 38, `@RequirePermissions(...)` bắt buộc mọi route.

---

## 1. Quyết định nghiệp vụ đã chốt (AskUserQuestion, phiên 2026-07-29)

1. **`unified-feed` bị loại bỏ khỏi scope** — FE gọi riêng `/notifications` + `/security-alerts` thay vì 1 API gộp. Xem lý do ở block đầu file.
2. **"Zone của team" (security alerts liên quan team của manager) — ĐỂ TRỐNG, không suy luận** — `manager-summary` KHÔNG trả security alerts theo team ở feature này (không có mapping zone↔team đáng tin cậy trong schema — zone gắn phòng họp/cổng, không gắn department/manager). Field này ghi rõ residual §6, KHÔNG bịa suy luận zone-theo-meeting-room như 1 phương án đã cân nhắc và bị từ chối.
3. **Cấu trúc**: 1 feature bundle chung 3 endpoint (feature này), KHÔNG tách 3 folder riêng.

## 2. Quyết định thiết kế suy luận thêm (chưa hỏi riêng — ghi rõ lý do, KHÔNG tự ý đổi khi code)

1. **Permission code + role cho từng endpoint** (3 permission mới, KHÔNG tái dùng permission cũ vì đây là 3 dữ liệu tổng hợp khác `overview`):
   - `campus_dashboard.manager_summary.read` → role **MANAGER** (chỉ MANAGER — endpoint tự-scope theo `req.user.id` là chính manager gọi, KHÔNG có tham số `managerId`; SYSTEM_ADMIN/BUSINESS_ADMIN gọi sẽ vô nghĩa vì họ không có `direct_manager_id`/team riêng theo nghĩa này — muốn xem theo team cụ thể, dùng `GET /campus-dashboard/overview` hoặc analytics hiện có).
   - `campus_dashboard.employee_summary.read` → role **SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER, EMPLOYEE** (cả 4 role — đây là dữ liệu "của chính người gọi", tương tự permission `notification.read.self`/`schedule.read.self` đã có convention trong repo, mọi người dùng đều cần xem "hôm nay của tôi").
   - `campus_dashboard.business_admin_summary.read` → role **BUSINESS_ADMIN, SYSTEM_ADMIN** (dữ liệu toàn tổ chức, KHÔNG MANAGER — khác `overview`/`timeline`/`traffic` vốn cho MANAGER xem để quản lý zone/khu vực, nhưng đây là số liệu điều hành cấp tổ chức).
2. **`manager-summary` — điều kiện team đúng logic đã có sẵn ở `meetings.service.ts`** (RECON §0.4): dùng lại ĐÚNG 2 nhánh `direct_manager_id`/`department.manager_user_id`, KHÔNG chỉ `direct_manager_id` đơn giản. Với "thành viên đã vào cơ quan hôm nay", CHỈ dùng `direct_manager_id` (KHÔNG mở rộng qua department — "gate access của team" nghĩa hẹp hơn "meeting request chờ duyệt", tránh 1 EMPLOYEE thuộc phòng ban nhưng không báo cáo trực tiếp bị tính nhầm vào "team" cho mục đích điểm danh).
3. **`manager-summary.onTimeRate`**: query MỚI trong `campus-dashboard` module (KHÔNG gọi `AnalyticsModule.OnTimeRateService` vì nó filter theo department, không theo `direct_manager_id`), nhưng PHẢI dùng cùng định nghĩa "on-time" ở RECON §0.7: check-in (`attendance_records`) trong X phút sau giờ họp bắt đầu, `X` đọc `system_configs` key `analytics.on_time_grace_minutes` NẾU đã tồn tại (kiểm tra ở T0), fallback **0 phút** nếu chưa có cấu hình (mirror default `graceMinutes ?? 0` của `on-time-rate.service.ts`). Phạm vi "tuần" = 7 ngày gần nhất tính đến hôm nay (server local timezone), participant tính = thành viên team (`direct_manager_id = manager`) là required participant của meeting trong khung 7 ngày.
4. **`manager-summary.pendingMeetingRequests`**: đếm (KHÔNG list chi tiết — chỉ số lượng, giữ response gọn) `meeting_requests` thỏa điều kiện §0.4, `approvalStatus='pending'`.
5. **`businessAdminSummary.zoneOccupancy`**: SUM `occupancy.count` (theo thuật toán `resolveOccupancyStatus` CDB-001 §2.3, tái dùng pure function `resolveOccupancyStatus`/`resolveCameraStatus` đã có ở `utils/`) của MỌI zone có `status != 'no_data'`; kèm `zonesWithDataCount`/`totalZoneCount` để FE biết % zone có tín hiệu tin cậy — KHÔNG lấy tổng "che giấu" số zone thiếu dữ liệu.
6. **`businessAdminSummary.vehicleControlHitsToday`**: `security_alerts` COUNT WHERE `alertType='vehicle_control_match' AND triggeredAt >= startOfDay(server local tz)` (RECON §0.5) — KHÔNG phân biệt blocklist/watchlist ở số tổng hợp này (chi tiết loại xem qua `GET /security-alerts?alertType=vehicle_control_match` đã có sẵn).
7. **`employeeSummary.vehicleStatus`**: bản ghi `vehicle_registrations` mới nhất (`ORDER BY createdAt DESC LIMIT 1`, `deletedAt IS NULL`) của `req.user.id` — trả nguyên `status` (`active`/`disabled`) + `plateNumber`, KHÔNG bịa field `approvalStatus` (chưa tồn tại, thuộc module `anpr` bàn giao thành viên khác). Nếu user chưa đăng ký xe nào → field `vehicleStatus: null`.
8. **`employeeSummary.securityAlertsNearby`**: **BỎ khỏi scope endpoint này** — cùng lý do §1.2 (không có mapping zone↔hiện diện cá nhân đáng tin cậy đơn giản; suy ra "zone hiện diện gần nhất" cần join `zone_presence_events`/`gate_access_logs` theo `userId`, nhưng `zone_presence_events.userId` là nullable và không phải mọi event đều có — dữ liệu không đủ tin cậy để hiển thị "cảnh báo an ninh gần bạn" mà không gây hiểu nhầm). Ghi residual §6, KHÔNG tự chế thuật toán suy luận vị trí.
9. **Response convention**: cả 3 endpoint trả `{success, message, data}` chuẩn CLAUDE.md §8.1, KHÔNG pagination (không phải list).
10. **Cấu trúc code**: 3 controller method — mirror pattern UC-119/120 "thêm controller vào module đã có". Đặt method summary trong 3 file controller MỚI riêng (`manager-summary.controller.ts`, `employee-summary.controller.ts`, `business-admin-summary.controller.ts`) thay vì gộp 1 controller lớn — mirror đúng convention "1 controller/service/dto-file cho 1 endpoint" đã xác nhận ở CDB-001 §0.5.

---

## 3. Scope

### TRONG scope
1. `GET /campus-dashboard/manager-summary` (permission `campus_dashboard.manager_summary.read`, role MANAGER):
   - `teamPresenceToday`: `{presentCount, totalCount}` — `totalCount` = số user `direct_manager_id=req.user.id`; `presentCount` = trong số đó, có `gate_access_logs` với `direction='in'` hôm nay.
   - `pendingMeetingRequestsCount`: số `meeting_requests` chờ manager này duyệt (§2.4).
   - `onTimeRateThisWeek`: số % (§2.3), kèm `sampleSize` (số required-participant-meeting dùng để tính, để FE hiển thị "chưa đủ dữ liệu" nếu quá nhỏ).
   - `teamZoneSecurityAlerts`: **luôn `null`** ở feature này (§2.8/§1.2), kèm field `note: "not_available"` để FE phân biệt với "0 alert".
2. `GET /campus-dashboard/employee-summary` (permission `campus_dashboard.employee_summary.read`, mọi role):
   - `gateAccessToday`: log `gate_access_logs` của `req.user.id` hôm nay (mảng rút gọn `{direction, accessTime}`, tối đa hiển thị — KHÔNG giới hạn cứng vì 1 người hiếm khi có > 10 log/ngày).
   - `vehicleStatus`: §2.7, có thể `null`.
   - `meetingsToday`: đếm meeting hôm nay mà `req.user.id` là participant (tái dùng logic đã có nếu `MeetingsService` có sẵn method tương tự — xác nhận ở T0 plan).
   - `securityAlertsNearby`: **KHÔNG có trong response** (§2.8 — loại hẳn field, không trả `null` giả).
3. `GET /campus-dashboard/business-admin-summary` (permission `campus_dashboard.business_admin_summary.read`, role BUSINESS_ADMIN/SYSTEM_ADMIN):
   - `gateTrafficToday`: `{entriesToday, exitsToday}` toàn tổ chức (SUM mọi zone, RECON §0.2 method mới).
   - `securityAlertsBySeverity`: `GROUP BY severity` trong ngày hôm nay (`triggeredAt >= startOfDay`), trả `{low, medium, high, critical}`.
   - `zoneOccupancy`: §2.5.
   - `vehicleControlHitsToday`: §2.6.
4. 3 migration seed permission mới (mirror `20260723000008-SeedCampusDashboardOverviewPermission.ts`).
5. Method tổng hợp mới trong `CampusDashboardRepository` (RECON §0.2) — TÁI DÙNG pure function `resolveOccupancyStatus`/`resolveCameraStatus` đã có, KHÔNG viết lại.

### NGOÀI scope (KHÔNG làm ở đây)
- `GET /notifications/unified-feed` — loại hẳn (§1.1).
- Bất kỳ thay đổi nào trong `src/modules/gate-access/` và `src/modules/anpr/` (kể cả seed permission cho 2 module đó) — thuộc thành viên khác phụ trách.
- `teamZoneSecurityAlerts` (manager-summary) và `securityAlertsNearby` (employee-summary) — không có mapping zone↔team/zone↔cá nhân đáng tin cậy, để residual.
- Sửa `AnalyticsModule.OnTimeRateService` để hỗ trợ scope theo `direct_manager_id` — ngoài phạm vi module `analytics`, feature này viết query riêng trong `campus-dashboard`.
- Seed `iot.device.read` cho `BUSINESS_ADMIN` (hiện chỉ `MANAGER, SYSTEM_ADMIN`, RECON phát hiện ngoài lề) — KHÔNG liên quan trực tiếp 3 endpoint này, xử lý như 1 migration nhỏ riêng biệt (không cần spec), báo cáo riêng cho Thiếu Chủ.
- WebSocket/realtime cho 3 summary — client tự polling, mirror CDB-001 §2.7.

---

## 4. Requirements (EARS)

- **R1**: **WHEN** MANAGER gọi `GET /campus-dashboard/manager-summary` **→** hệ thống trả `teamPresenceToday`, `pendingMeetingRequestsCount`, `onTimeRateThisWeek`, `teamZoneSecurityAlerts: null`.
- **R2 (crux)**: **WHEN** tính `pendingMeetingRequestsCount` **→** hệ thống dùng ĐÚNG điều kiện 2 nhánh đã có ở `meetings.service.ts` (`requester.direct_manager_id = manager` HOẶC `requester.department_id ∈ departments mà manager là manager_user_id`), KHÔNG chỉ lọc `direct_manager_id` đơn thuần.
- **R3**: **WHEN** tính `teamPresenceToday` **→** hệ thống CHỈ dùng `direct_manager_id = manager` (KHÔNG mở rộng qua department, khác R2).
- **R4 (crux)**: **WHEN** tính `onTimeRateThisWeek` **→** hệ thống dùng ngưỡng "on-time" GIỐNG `on-time-rate.service.ts` (check-in trong X phút sau giờ bắt đầu, X đọc `system_configs` hoặc fallback 0), KHÔNG tự định nghĩa ngưỡng khác.
- **R5**: **WHEN** EMPLOYEE/MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN gọi `GET /campus-dashboard/employee-summary` **→** hệ thống trả dữ liệu CỦA CHÍNH `req.user.id`, KHÔNG có field `securityAlertsNearby`.
- **R6**: **WHEN** user gọi `employee-summary` và CHƯA từng đăng ký xe **→** `vehicleStatus: null`, KHÔNG lỗi.
- **R7**: **WHEN** BUSINESS_ADMIN/SYSTEM_ADMIN gọi `GET /campus-dashboard/business-admin-summary` **→** hệ thống trả `gateTrafficToday`, `securityAlertsBySeverity`, `zoneOccupancy` (kèm `zonesWithDataCount`/`totalZoneCount`), `vehicleControlHitsToday`.
- **R8**: **WHEN** người dùng KHÔNG có permission tương ứng gọi 1 trong 3 endpoint **→** hệ thống trả `403`.
- **R9**: **WHEN** MANAGER gọi `employee-summary` hoặc `business-admin-summary` gọi `manager-summary` (permission không khớp role-đích) **→** hệ thống trả `403` (permission theo role cứng §2.1, KHÔNG có admin-bypass).

## 5. Constitution

- **ARCH-01**: Business logic nằm trong 3 service method mới (`ManagerSummaryService`/`EmployeeSummaryService`/`BusinessAdminSummaryService`, hoặc gộp method trong `CampusDashboardRepository` + 1 service dùng chung — quyết định cụ thể ở plan.md §5), controller chỉ nhận request + gọi service.
- **ARCH-02**: KHÔNG import `MeetingsModule`/`AnalyticsModule`/`AnprModule` để tái dùng service nội bộ của module khác — nếu cần logic tương tự (§2.2 pending-request condition, §2.3 on-time), viết LẠI query trong `campus-dashboard` (đọc entity trực tiếp qua `forFeature`, mirror CDB-001 §2.6) — giữ đúng nguyên tắc module boundary đã áp dụng cho `campus-dashboard` (không kéo dư provider/controller không cần).
- **DATA-01**: Module 100% READ-ONLY — KHÔNG INSERT/UPDATE/DELETE bảng nào ở 3 endpoint này.
- **SEC-01**: MỌI route PHẢI có `@RequirePermissions`, đúng permission-role đã chốt §2.1 — KHÔNG admin-bypass.
- **NO-SCOPE-01**: KHÔNG code `unified-feed`, KHÔNG đụng `src/modules/gate-access/`, `src/modules/anpr/` (trừ SELECT read-only từ entity đã export), KHÔNG sửa `OnTimeRateService`/`AlertsService`/`MeetingsService` hiện có.

## 6. Residuals / known-gaps

- **`teamZoneSecurityAlerts` (manager-summary) luôn `null`** — không có mapping zone↔team đáng tin cậy trong schema hiện tại. Nếu sau này Hải/team thêm mapping zone↔department (hoặc phòng họp team hay dùng), đây là điểm mở rộng tự nhiên — KHÔNG suy luận tạm bằng "zone theo meeting room 30 ngày gần nhất" (đã cân nhắc và bị loại vì phức tạp/không đáng tin, xem §1.2).
- **`securityAlertsNearby` (employee-summary) bị loại hẳn khỏi response** — cùng lý do trên, ở mức cá nhân còn khó suy luận hơn (không phải mọi `zone_presence_events` đều gắn `userId`).
- **`onTimeRateThisWeek` là query MỚI, KHÔNG tái dùng `OnTimeRateService`** — 2 nơi tính "on-time" trong code (module `analytics` theo department, module `campus-dashboard` theo team) dùng CHUNG định nghĩa ngưỡng nhưng khác code path — rủi ro lệch nếu sau này ai đó sửa ngưỡng ở 1 nơi mà quên nơi kia. Cân nhắc refactor thành 1 shared utility ở đợt sau nếu team thấy cần.
- **`iot.device.read` thiếu `BUSINESS_ADMIN`** — phát hiện ngoài lề khi RECON, KHÔNG thuộc scope 3 endpoint này, xử lý như 1 migration nhỏ riêng, báo cáo cho Thiếu Chủ quyết định có làm cùng đợt hay không.
- **`businessAdminSummary.zoneOccupancy` cộng dồn occupancy các zone `count` KHÔNG đồng thời** — mỗi zone lấy event mới nhất RIÊNG của zone đó (có thể lệch vài phút giữa các zone), tổng chỉ mang tính ước lượng "tại thời điểm gần nhất mỗi zone có dữ liệu", KHÔNG phải snapshot đồng thời toàn trường — chấp nhận được cho mục đích dashboard tổng quan, ghi rõ cho FE tránh hiểu nhầm là số real-time chính xác tuyệt đối.

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md trước khi cho phép code.
