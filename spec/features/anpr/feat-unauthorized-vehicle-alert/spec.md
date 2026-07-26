# Feature Specification: Cảnh báo xe không có quyền



## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |

| :--- | :--- | :--- |

| 2026-07-25 | Tạo plan.md và artifacts (research.md, data-model.md, quickstart.md, contracts) | Toàn bộ plan.md và các artifacts |

| 2026-07-25 | Clarify UC-108: áp dụng 13 quyết định từ phiên speckit-clarify (BL-01→EH-03) | Mục 1.4, 3.1, 3.2, 3.3, 3.4, 3.7, 5.4, 5.5, 6.3, 7.1, 7.5, 7.10 |

| 2026-07-25 | Tạo spec cho UC-108 Cảnh báo xe không có quyền (ANPR-ALERT-001) | Toàn bộ file |



---



- **Feature ID**: ANPR-ALERT-001

- **Feature Name**: Cảnh báo xe không có quyền

- **Module / Domain**: anpr + alerts

- **Created Date**: 2026-07-25

- **Status**: Draft

- **Source Documents**:

  - AGENTS.md - Phần mở rộng SAVP (mục 5.5)

  - UC-108 (kế hoạch mở rộng SAVP)

  - Goal objective UC-108 (ANPR-ALERT-001)



---



## 1. Context & Goal



### 1.1 Bối cảnh



SAVP mở rộng giám sát toàn khuôn viên bao gồm kiểm soát phương tiện ra vào cổng. Khi IVSS/ANPR ghi nhận biển số tại zone loại "gate", hệ thống cần đối chiếu biển số đó với danh sách đăng ký và danh sách kiểm soát để phát hiện xe không có quyền (xe lạ, xe bị chặn, xe cần theo dõi, xe đang chờ duyệt/bị từ chối) và tạo cảnh báo kịp thời.



Tính năng này thuộc module anpr (xử lý sự kiện biển số) và tích hợp module alerts (ghi nhận security_alerts + cấu hình alert_rules). UC-108 là một phần trong chuỗi UC an ninh khuôn viên (UC-90 → UC-120).



Phụ thuộc:

- UC-90→94 Zone Model - zone_id thực tế để gắn cảnh báo vào khu vực cụ thể

- UC-112 Ghi nhận sự kiện biển số - trigger duy nhất để kích hoạt đánh giá

- UC-113 Danh sách kiểm soát phương tiện - nguồn dữ liệu vehicle_control_list



### 1.2 Mục tiêu



Hệ thống tự động phát hiện 4 tình huống xe không có quyền qua cổng và tạo cảnh báo tương ứng, giúp MANAGER / BUSINESS_ADMIN / SYSTEM_ADMIN kịp thời xử lý.



### 1.3 Giá trị mang lại



- Giảm nguy cơ an ninh do xe lạ, xe bị chặn ra vào khuôn viên

- Tự động hóa giám sát thay vì trực quan thủ công

- Ghi nhận đầy đủ nhật ký sự cố phục vụ audit và báo cáo

- Phân loại mức độ nghiêm trọng để ưu tiên xử lý



### 1.4 Giả định



- Zone CRUD (UC-90→94) đã hoàn thiện, zone_id thực tế có sẵn khi đánh giá biển số

- vehicle_registrations đã có dữ liệu đăng ký biển số hợp lệ của nhân viên

- vehicle_control_list đã có dữ liệu blocklist/watchlist do admin nhập (UC-113)

- IVSS webhook (UC-112) đã ghi nhận sự kiện biển số vào iot_device_events

- Security Alert Center (UC-122/123) chưa implement - cảnh báo chỉ lưu DB + in-app notification

- plateNumber đã được normalize bởi UC-112/UC-4 (webhook handler) trước khi vào evaluate(). UC-108 không normalize lại — nhận plateNumber đã sạch.



### 1.5 Cần làm rõ



(Không có - các quyết định đã được chốt trong goal objective.)



---

## 2. Actor & Roles



### 2.1 Danh sách actor



| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |

|---|---|---|

| System (tự động) | Trigger bởi webhook biển số từ IVSS, tự động đánh giá và tạo cảnh báo | Đối chiếu biển số với vehicle_registrations và vehicle_control_list; ghi security_alerts; gửi in-app notification |

| IVSS (Dahua IP Video Surveillance) | Nguồn sự kiện biển số qua webhook ANPR | Gửi sự kiện biển số (plateNumber, channelId, direction, utc) |

| Manager / Business Admin / System Admin | Người nhận cảnh báo, xử lý alert | Nhận in-app notification; sau này (UC-123) xem và xử lý security_alerts |



### 2.2 Role & Permission Rules



- Chỉ MANAGER / BUSINESS_ADMIN / SYSTEM_ADMIN được nhận cảnh báo in-app từ tính năng này

- API đọc danh sách alert/unknown vehicles yêu cầu permission vehicle_alert.read (tách biệt với vehicle_control.read của UC-113)

- Permission vehicle_alert.read cần được seed bằng migration riêng (không dùng chung migration UC-113)

- Người dùng không có role hoặc permission phù hợp không nhận được notification và không được truy cập API alert

- CRUD vehicle_control_list và vehicle_registrations thuộc feature khác (UC-113, UC riêng)



### 2.3 Actor Constraints



- System: phải có zone_id thực tế từ UC-90→94, không hardcode null

- IVSS: phải được cấu hình webhook trỏ đúng endpoint backend

- Manager / Business Admin / System Admin: phải đăng nhập hệ thống, phải có quyền vehicle_alert.read để truy cập API alert history



---

## 3. Functional Requirements



### 3.1 Ubiquitous Requirements



FR-001: THE system SHALL xác định 4 tình huống xe không có quyền và đánh giá theo thứ tự ưu tiên sau (priority chain — chỉ tạo 1 alert cho tình huống có mức ưu tiên cao nhất):

- (B) Xe trong vehicle_control_list loại blocklist — ƯU TIÊN CAO NHẤT

- (C) Xe trong vehicle_control_list loại watchlist — ƯU TIÊN 2

- (A) Xe lạ — biển số không tồn tại trong bất kỳ vehicle_registrations nào — ƯU TIÊN 3

- (D) Xe có vehicle_registrations với status pending hoặc rejected — ƯU TIÊN THẤP NHẤT

Nếu biển số rơi vào nhiều tình huống đồng thời (ví dụ: blocklist + active registration), chỉ tạo 1 alert theo tình huống có ưu tiên cao nhất. Blocklist luôn thắng, kể cả khi biển số có đăng ký active hợp lệ.



FR-002: THE system SHALL áp dụng severity mapping như sau: blocklist = high, watchlist = medium, xe lạ = medium, pending/rejected = low.



FR-003: THE system SHALL sử dụng alert_type riêng cho từng tình huống: vehicle_control_match (B, C), unknown_vehicle (A), vehicle_unauthorized (D).



### 3.2 Event-driven Requirements



FR-004: WHEN IVSS gửi sự kiện biển số qua webhook ANPR (UC-112) và VehicleResolveService nhận được event, THE system SHALL:

1. INSERT event vào iot_device_events trước để lấy eventId (source_event_id);

2. Gọi evaluate(plateNumber, context, eventId) — evaluate() bao gồm toàn bộ priority chain (B→C→A→D) theo FR-001, không phụ thuộc VehicleUnknownService cho logic alert;

3. Lỗi trong evaluate() không rollback bước (1) — NotThrow độc lập theo FR-009.

Ghi chú: VehicleUnknownService chỉ phục vụ UC-6/UC-7 (query lịch sử xe lạ), không được gọi trong evaluate() của UC-108.



FR-005: WHEN biển số match vehicle_control_list loại blocklist, THE system SHALL ghi security_alerts với alert_type=vehicle_control_match, severity=high và tạo in-app notification với nội dung Cảnh báo: xe trong danh sách chặn.



FR-006: WHEN biển số match vehicle_control_list loại watchlist, THE system SHALL ghi security_alerts với alert_type=vehicle_control_match, severity=medium và tạo in-app notification với nội dung Cảnh báo: xe cần theo dõi.



FR-007: WHEN biển số không match bất kỳ vehicle_registrations active nào (xe lạ hoàn toàn), THE system SHALL ghi security_alerts với alert_type=unknown_vehicle, severity=medium và tạo in-app notification với nội dung Cảnh báo: biển số không xác định.



FR-008: WHEN biển số tồn tại trong vehicle_registrations với status pending hoặc rejected, THE system SHALL ghi security_alerts với alert_type=vehicle_unauthorized, severity=low và tạo in-app notification với nội dung Thông báo: xe đang chờ duyệt/bị từ chối.



FR-008b: WHEN VehicleResolveService xử lý event biển số, THE system SHALL INSERT vào iot_device_events TRƯỚC khi gọi evaluate(), để source_event_id trong security_alerts có thể tham chiếu đến event gốc. IF INSERT iot_device_events thất bại, THEN THE system SHALL log lỗi và bỏ qua evaluate() — không tạo alert không có evidence.



### 3.3 Unwanted Behavior Requirements



FR-009: IF alert evaluation gặp lỗi (recordAlert, createNotification, hoặc bất kỳ lỗi nào trong evaluate()), THEN THE system SHALL log lỗi và KHÔNG được block hoặc fail luồng webhook ingest chính (VehicleResolveService.onVehicleEvent). Yêu cầu NotThrow toàn bộ alert logic.



FR-010: IF cùng một biển số (plateNumber) được phát hiện nhiều lần trong khoảng thời gian throttle (mặc định 5 phút), THEN THE system SHALL bỏ qua toàn bộ evaluate() để tránh spam notification, trừ lần đầu tiên trong window. Throttle key là plateNumber đơn thuần — không phân biệt theo alert_type hay severity. Nếu severity thay đổi trong window (ví dụ: watchlist được nâng lên blocklist), hệ thống vẫn bỏ qua, ưu tiên chống spam hơn cập nhật severity.



FR-011: THE system SHALL kiểm tra alert_rules cho từng alert_type tương ứng trước khi tạo alert:

- alert_type=vehicle_control_match: áp dụng cho tình huống (B) và (C)

- alert_type=unknown_vehicle: áp dụng cho tình huống (A)

- alert_type=vehicle_unauthorized: áp dụng cho tình huống (D)

IF rule tương ứng tồn tại và enabled=false (suppressed), THEN THE system SHALL KHÔNG ghi security_alerts và KHÔNG gửi notification cho tình huống đó.

IF không tìm thấy rule entry cho alert_type tương ứng, THEN THE system SHALL coi như enabled=true (không suppress) — safe default để không vô tình tắt cảnh báo an ninh.



FR-012: IF không resolve được recipient (không có user nào thuộc role MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN active), THEN THE system SHALL ghi log warning và bỏ qua bước gửi notification, KHÔNG ảnh hưởng đến việc ghi security_alerts.



FR-013: IF ghi security_alerts thất bại (DB error), THEN THE system SHALL log lỗi và vẫn tiếp tục gửi notification (không để lỗi ghi alert chặn notification).



### 3.4 State-driven Requirements



FR-014: WHILE alert logic đang thực thi evaluate(), IF cùng biển số tiếp tục xuất hiện trong cùng throttle window, THEN THE system SHALL bỏ qua mà không cập nhật mốc thời gian throttle.



FR-015: WHILE security_alerts chưa được acknowledge hoặc resolve (status=new), IF event mới cho cùng biển số đến sau khi throttle window kết thúc, THEN THE system SHALL tạo security_alerts mới (không update bản ghi cũ).



### 3.5 Authorization Requirements



FR-016: IF không tìm thấy user token hợp lệ, THEN THE system SHALL từ chối truy cập API đọc danh sách unknown vehicles.



FR-017: IF user không có quyền vehicle_alert.read, THEN THE system SHALL từ chối truy cập API liên quan đến cảnh báo xe.



FR-018: WHEN system tự động ghi security_alerts và gửi notification, THE system SHALL sử dụng recipient list từ role: MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN.



### 3.6 Integration Requirements



FR-019: WHERE zone_id (từ UC-90-94) đã có sẵn, WHEN tạo security_alerts, THE system SHALL gắn zone_id tương ứng với zone_type=gate nơi biển số được ghi nhận.



FR-020: WHEN evaluate() chuẩn bị tạo security_alerts, THE system SHALL resolve zone_id từ channelId bằng cách query iot_devices.zone_id cho device tương ứng với channelId nhận được từ IVSS. IF không resolve được zone_id (device chưa gắn zone hoặc UC-90→94 chưa hoàn thiện), THEN THE system SHALL dùng zone_id=null, ghi log warning, và tiếp tục tạo alert bình thường (zone_id nullable không block alert).



### 3.7 Requirement Notes



- Tất cả alert logic (evaluate) phải NotThrow - không block luồng webhook ingest chính

- Throttle in-memory: single-instance, reset khi restart service

- Kênh gửi: IN-APP ONLY, không email, không WebSocket push (WebSocket thuộc UC-123)

- Payload security_alerts phải chứa plateNumber, listType (nếu có), reason (nếu có), channelId, direction

- Throttle in-memory reset khi service restart — known limitation, chấp nhận cho scope capstone. Sau restart, alert đầu tiên cho mọi plate đều được sinh bất kể lần trước đã alert chưa.



### 3.8 Traceability



| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |

|---|---|---|---|

| FR-001 | Ubiquitous | UC-108 | 4 tình huống đã chốt |

| FR-002 | Ubiquitous | UC-108 | Severity mapping |

| FR-003 | Ubiquitous | UC-108 | alert_type mapping |

| FR-004 | Event-driven | UC-108, UC-112 | Trigger từ webhook |

| FR-005 | Event-driven | UC-108 (B) | Blocklist alert |

| FR-006 | Event-driven | UC-108 (C) | Watchlist alert |

| FR-007 | Event-driven | UC-108 (A) | Unknown vehicle alert |

| FR-008 | Event-driven | UC-108 (D) | Pending/rejected alert |

| FR-008b | Event-driven | UC-108 | source_event_id flow |

| FR-009 | Unwanted Behavior | UC-108 | NotThrow toàn bộ |

| FR-010 | Unwanted Behavior | UC-108 | Throttle 5 phút |

| FR-011 | Unwanted Behavior | UC-108 | Alert rules suppress |

| FR-012 | Unwanted Behavior | UC-108 | No recipient fallback |

| FR-013 | Unwanted Behavior | UC-108 | recordAlert fail NotThrow |

| FR-014 | State-driven | UC-108 | Throttle window |

| FR-015 | State-driven | UC-108 | New alert after window |

| FR-016 | Authorization | UC-108 | Auth check |

| FR-017 | Authorization | UC-108 | vehicle_alert.read check |

| FR-018 | Authorization | UC-108 | Recipient roles |

| FR-019 | Integration | UC-108, UC-90-94 | Zone_id gắn alert |

| FR-020 | Integration | UC-108, UC-90-94 | channelId → zone_id |



---

## 4. Non-functional Requirements



### 4.1 Performance



NFR-001: THE system SHALL đáp ứng alert evaluation trong vòng dưới 500ms cho mỗi sự kiện biển số dưới tải thông thường.

NFR-002: WHEN luồng sự kiện biển số vượt quá ngưỡng 100 event/giây, THE system SHALL vẫn đảm bảo không mất event (hàng đợi hoặc xử lý bất đồng bộ).

NFR-003: Throttle in-memory mặc định 5 phút mỗi plate - không tạo security_alerts hoặc notification trùng lặp trong cùng window.



### 4.2 Security



NFR-004: THE system SHALL require authentication trước khi cho phép truy cập danh sách unknown vehicles hoặc alert history.

NFR-005: THE system SHALL enforce authorization (vehicle_alert.read) cho mọi API đọc dữ liệu cảnh báo.

NFR-006: THE system SHALL KHÔNG expose thông tin nhạy cảm (imageBase64, token) trong payload security_alerts hoặc notification.

NFR-007: IF request chứa token không hợp lệ hoặc hết hạn, THEN THE system SHALL reject request.



### 4.3 Reliability & Consistency



NFR-008: THE system SHALL đảm bảo alert evaluation KHÔNG làm gián đoạn luồng webhook ingest chính trong bất kỳ trường hợp lỗi nào.

NFR-009: WHEN security_alerts được ghi, THE system SHALL ghi đủ trigger zone_id (nếu có), source_event_id, và thời điểm triggered_at.

NFR-010: IF DB connection bị gián đoạn trong lúc ghi alert, THEN THE system SHALL log lỗi và không retry (không block event ingest).



### 4.4 Observability



NFR-011: THE system SHALL log error khi alert evaluation thất bại, bao gồm plateNumber, channelId, và nguyên nhân lỗi.

NFR-012: THE system SHALL log warning khi không resolve được recipient.

NFR-013: THE system SHALL log warning khi biển số bị throttle.



---



## 5. Data Model



### 5.1 Entity liên quan



| Entity / Table | Vai trò trong tính năng | Ghi chú |

|---|---|---|

| vehicle_control_list | Danh sách blocklist/watchlist để đối chiếu tình huống (B) và (C) | VehicleControlListEntity đã có |

| vehicle_registrations | Bảng đăng ký biển số hợp lệ - xác định xe lạ (A) và pending/rejected (D) | VehicleRegistrationEntity đã có |

| security_alerts | Nhật ký cảnh báo an ninh | SecurityAlertEntity đã có |

| alert_rules | Cấu hình bật/tắt cho từng alert_type | AlertRuleEntity đã có |

| notifications | Thông báo in-app | NotificationEntity đã có |

| iot_device_events | Sự kiện biển số từ IVSS - trigger duy nhất | event_type=ivss_vehicle_event |

| zones | Khu vực vật lý - gắn alert vào cổng cụ thể | ZoneEntity đã có |



### 5.2 Dữ liệu đầu vào (từ IVSS webhook)



| Field | Type | Required | Description |

|---|---:|---:|---|

| plateNumber | string(16) | Yes | Biển số đã normalize |

| plateRaw | string(20) | No | Biển số gốc từ camera |

| channelId | integer | Yes | Kênh camera ghi nhận |

| direction | string | No | enter/leave/seen |

| utc | string | Yes | Thời gian ISO |



### 5.3 Dữ liệu đầu ra (security_alerts)



| Field | Type | Description |

|---|---:|---|

| alert_type | string(40) | unknown_vehicle / vehicle_control_match / vehicle_unauthorized |

| severity | string(20) | low / medium / high |

| zone_id | uuid nullable | Khu vực nơi biển số được ghi nhận |

| payload_json | jsonb | { plateNumber, listType, reason, channelId, direction, controlListEntryId } |

| source_event_id | uuid nullable | FK đến iot_device_events.id |



### 5.4 Severity & Alert Type Mapping



| Tình huống | alert_type | severity | Notification message |

|---|---|---|---|

| Xe blocklist | vehicle_control_match | high | Cảnh báo: xe trong danh sách chặn |

| Xe watchlist | vehicle_control_match | medium | Cảnh báo: xe cần theo dõi |

| Xe lạ (unmatched) | unknown_vehicle | medium | Cảnh báo: biển số không xác định |

| Xe pending/rejected | vehicle_unauthorized | low | Thông báo: xe đang chờ duyệt/bị từ chối |



**Ghi chú overlap:** Nếu biển số tồn tại trong cả vehicle_control_list (blocklist) và vehicle_registrations (active), chỉ tạo 1 alert với alert_type=vehicle_control_match, severity=high. Trạng thái đăng ký active không được miễn trừ biển số khỏi blocklist. Xem FR-001 (priority chain).



### 5.5 Data Constraints



- security_alerts: không soft-delete (audit trail an ninh, append-only)

- security_alerts: KHÔNG dùng DB unique constraint để dedup — PostgreSQL không chặn được NULL != NULL cho zone_id. Dedup chính thức là throttle in-memory 5 phút per plateNumber (FR-010).

- vehicle_control_list: plate_number + list_type là unique partial WHERE deleted_at IS NULL

- KHÔNG xóa security_alerts - chỉ update status (new -> acknowledged -> resolved)



### 5.6 Data Lifecycle



- security_alerts được tạo khi IVSS sự kiện biển số được xử lý

- security_alerts được cập nhật status khi người dùng acknowledge/resolve (thuộc UC-123)

- security_alerts là append-only - không bao giờ xóa vật lý

- notification được tạo đồng thời với security_alerts



---

## 6. Error Handling



### 6.1 Validation Errors



ERR-001: IF plateNumber missing hoặc empty trong webhook payload, THEN THE system SHALL từ chối xử lý event và ghi log lỗi validation.

ERR-002: IF channelId missing hoặc invalid, THEN THE system SHALL xử lý event với channelId=null và ghi log warning.



### 6.2 Authorization Errors



ERR-003: IF user call API (read unknown vehicles, alert history) không có quyền vehicle_alert.read, THEN THE system SHALL return 403 Forbidden.

ERR-004: IF user không thuộc role MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN, THEN THE system SHALL không gửi notification khi system tạo cảnh báo.



### 6.3 Business Rule Errors



ERR-005: IF không thể resolve được IVSS-BRIDGE device (chưa seed), THEN THE system SHALL ghi log warning và skip toàn bộ xử lý vehicle ingest (bao gồm alert evaluation).

ERR-006: IF vehicle_registrations query thất bại (DB error), THEN THE system SHALL log warning với plateNumber và nguyên nhân lỗi, BỎ QUA toàn bộ alert evaluation (không tạo alert), và vẫn persist event vào iot_device_events bình thường. Không tạo false positive alert từ lỗi DB nhất thời.



### 6.4 Integration / External Service Errors



ERR-007: IF DB connection bị gián đoạn trong lúc ghi security_alerts, THEN THE system SHALL log lỗi và KHÔNG retry.

ERR-008: IF createNotification thất bại, THEN THE system SHALL log lỗi và không ảnh hưởng đến security_alerts đã ghi thành công.



### 6.5 Expected Error Response



| Field | Description |

|---|---|

| statusCode | HTTP status code |

| message | Error message |

| error | Error type |

| timestamp | Time of error |



---



## 7. Acceptance Criteria



### 7.1 Happy Path - Blocklist



AC-001:

Given một biển số đang có trong vehicle_control_list với list_type=blocklist và active=true,

When IVSS gửi sự kiện biển số đó qua webhook ANPR,

Then the system:

- INSERT event vào iot_device_events TRƯỚC (matched status)

- Ghi security_alert với alert_type=vehicle_control_match, severity=high

- security_alert.source_event_id tham chiếu đến iot_device_events.id vừa INSERT

- Tạo in-app notification cho MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN



### 7.2 Happy Path - Watchlist



AC-002:

Given một biển số đang có trong vehicle_control_list với list_type=watchlist và active=true,

When IVSS gửi sự kiện biển số đó qua webhook ANPR,

Then the system ghi security_alert với alert_type=vehicle_control_match, severity=medium và tạo in-app notification.



### 7.3 Happy Path - Unknown Vehicle



AC-003:

Given một biển số KHÔNG có trong bất kỳ vehicle_registrations active nào,

When IVSS gửi sự kiện biển số đó qua webhook ANPR,

Then the system ghi security_alert với alert_type=unknown_vehicle, severity=medium và tạo in-app notification.



### 7.4 Happy Path - Pending/Rejected Registration



AC-004:

Given một biển số có trong vehicle_registrations với status=pending hoặc rejected,

When IVSS gửi sự kiện biển số đó qua webhook ANPR,

Then the system ghi security_alert với alert_type=vehicle_unauthorized, severity=low và tạo in-app notification.



### 7.5 Throttle - Không Spam



AC-005:

Given biển số "51A-12345" đã trigger alert bất kỳ loại nào (ví dụ: watchlist),

When IVSS tiếp tục gửi sự kiện cho "51A-12345" trong vòng 5 phút (kể cả khi alert_type khác, ví dụ: blocklist),

Then the system không tạo thêm alert hoặc notification — throttle áp dụng theo plateNumber bất kể alert_type hay severity thay đổi trong window.



### 7.6 NotThrow - Lỗi DB Alert



AC-006:

Given DB security_alerts bị lỗi trong lúc ghi,

When IVSS gửi sự kiện biển số khớp vehicle_control_list,

Then the system:

- Ghi log error

- Không fail event ingest chính (iot_device_events vẫn được persist)

- Vẫn gửi in-app notification (nếu có thể)



### 7.7 NotThrow - Lỗi Notification



AC-007:

Given createNotification thất bại,

When IVSS gửi sự kiện biển số khớp vehicle_control_list,

Then the system:

- security_alert vẫn được ghi thành công

- Không fail toàn bộ VehicleResolveService.onVehicleEvent



### 7.8 Suppressed Rule



AC-008:

Given alert_rules cho alert_type=vehicle_control_match đang bị suppressed (enabled=false),

When IVSS gửi sự kiện biển số khớp vehicle_control_list,

Then the system không ghi security_alert và không gửi notification.



### 7.9 No Recipient



AC-009:

Given không có user nào thuộc role MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN active,

When IVSS gửi sự kiện biển số khớp vehicle_control_list,

Then the system vẫn ghi security_alert thành công, ghi log warning, không gửi notification.



### 7.10 Zone ID Null - Fallback



AC-010:

Given zone_id chưa được cấu hình (null),

When IVSS gửi sự kiện biển số khớp vehicle_control_list,

Then the system vẫn ghi security_alert thành công với zone_id=null (không block alert).



### 7.11 Acceptance Criteria Traceability



| AC ID | Requirement liên quan | Kịch bản test chính |

|---|---|---|

| AC-001 | FR-001, FR-005 | Blocklist alert flow |

| AC-002 | FR-001, FR-006 | Watchlist alert flow |

| AC-003 | FR-001, FR-007 | Unknown vehicle alert flow |

| AC-004 | FR-001, FR-008 | Pending/rejected alert flow |

| AC-005 | FR-010 | Throttle prevention |

| AC-006 | FR-009, FR-013 | DB error NotThrow |

| AC-007 | FR-009 | Notification error NotThrow |

| AC-008 | FR-011 | Suppressed rule |

| AC-009 | FR-012 | No recipient fallback |

| AC-010 | FR-019 | Zone_id nullable |



---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- FE dashboard cho security alerts (thuộc UC-117/UC-123)
- Báo cáo sự kiện an ninh (thuộc UC-129)
- WebSocket realtime push cho Security Dashboard (thuộc UC-123)
- Email notification (chỉ in-app)
- CRUD vehicle_control_list (thuộc UC-113)
- CRUD vehicle_registrations (thuộc module anpr riêng)
- Camera offline alert, person watchlist, vehicle behavior analysis
- Thêm bảng database mới (đã có đủ bảng cho UC-108)

### 8.2 Có thể xem xét ở feature khác

- Xử lý zone_id từ camera channel mapping (cần UC-90->94 hoàn thiện)
- Tích hợp blocklist/watchlist với external blacklist API
- Auto-resolve alert khi xe đã ra khỏi khuôn viên

### 8.3 Out-of-scope EARS Guardrails

OOS-001: THE system SHALL NOT implement Security Alert Center (UC-122/123) như một phần của UC-108.
OOS-002: THE system SHALL NOT tạo bảng database mới - đã có đủ bảng cho UC-108.
OOS-003: WHERE WebSocket push được mention cho context, THE system SHALL NOT implement WebSocket push trong UC-108.

---