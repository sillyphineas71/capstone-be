# Feature Specification: Xem nhật ký kiểm tra hệ thống (Audit Logs)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Tạo spec lần đầu cho UC-AA-11 Xem nhật ký kiểm tra hệ thống. Đã phân tích, liệt kê điểm mơ hồ, đề xuất phương án và được người dùng duyệt 4 quyết định chính (thêm bộ lọc tùy chọn, cột "Trạng thái" map vào `severity`, permission chỉ seed cho SYSTEM_ADMIN, không trả JSON chi tiết trong list) trước khi viết spec (xem §0 RECON). Các điểm mơ hồ nhỏ còn lại chốt theo phương án khuyến nghị (người dùng không phản đối). | Toàn bộ file |

---

- **Feature ID**: ADM-VIEW-AUDIT-LOGS-001
- **Feature Name**: Xem nhật ký kiểm tra hệ thống (View System Audit Logs)
- **Use Case**: UC-AA-11 Xem nhật ký kiểm tra hệ thống (Audit Logs)
- **Module / Domain**: administration
- **Created Date**: 2026-07-02
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu trực tiếp của người dùng — mô tả UC-AA-11 (actor, trigger, precondition, postcondition, normal flow, business rules)
  - `database_v3_2_compact_39_tables.md` — bảng `audit_logs` (mục 39)
  - `src/modules/administration/entities/audit-log.entity.ts` — xác nhận field thật (`userId, actionType, entityType, entityId, severity, createdAt`, KHÔNG có cột "status")
  - `src/modules/administration/services/audit-logs.service.ts` — xác nhận service hiện tại **chỉ có hàm ghi** (`logAction`/`logSecurityEvent`/`logEntityChange`), chưa có hàm đọc/liệt kê nào
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — bảng permission (mục cuối) đã có sẵn tên `audit.system.read` ("Xem toàn bộ audit logs") nhưng **chưa gắn với bất kỳ controller/UC nào** — không có UC-1xx baseline để đối chiếu (khác UC-AA-01→10 đều có UC-148...157 sẵn)
  - `.specify/memory/constitution.md`, `CLAUDE.md`

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã duyệt cùng người dùng

### 0.1. Không có API_CONTRACT baseline — spec thiết kế mới hoàn toàn

Khác UC-AA-01→10 (đều có sẵn UC-148...157 làm baseline để đối chiếu/mở rộng), UC-AA-11 **không có endpoint/response mẫu nào có sẵn** trong `API_CONTRACT`. Chỉ có tên permission `audit.system.read` đã được liệt kê trong bảng permission tổng nhưng chưa gắn vào bất kỳ route nào. **Quyết định**: thiết kế endpoint mới hoàn toàn `GET /api/v1/audit-logs`, dùng đúng permission có sẵn tên này.

### 0.2. Bổ sung bộ lọc dù Normal Flow chỉ mô tả phân trang — đã duyệt

Normal Flow (bước 1-5) chỉ mô tả tải danh sách mới nhất + phân trang, không hề nhắc bất kỳ bộ lọc nào. Tuy nhiên Description gọi đây là "trung tâm giám sát an ninh" — duyệt toàn bảng `audit_logs` (tăng trưởng vô hạn theo thời gian) mà không có cách thu hẹp phạm vi sẽ gần như vô dụng ở quy mô thật. **Quyết định đã duyệt**: bổ sung bộ lọc **tùy chọn** (`from`/`to`, `userId`, `actionType`, `entityType`, `severity`) ngoài phạm vi literal của Normal Flow, nhưng giữ hành vi mặc định đúng bước 2 (không truyền gì → tải danh sách mới nhất, không lọc).

### 0.3. Cột "Trạng thái" — map vào `severity` — đã duyệt

`audit_logs` không có cột "trạng thái thành công/thất bại". Cột gần nghĩa nhất hiện có là `severity` (`info|warning|error|critical`). **Quyết định đã duyệt**: cột "Trạng thái" trong Normal Flow bước 3 hiển thị đúng giá trị `severity`, không tạo khái niệm "trạng thái" mới không có trong schema.

### 0.4. Phạm vi role — chỉ `SYSTEM_ADMIN` — đã duyệt

Primary Actor của UC-AA-11 chỉ ghi "System Admin" (khác mọi UC-AA khác đều có Manager/Business Admin). **Quyết định đã duyệt**: seed permission `audit.system.read` chỉ gán cho role `SYSTEM_ADMIN`. Không tự ý mở rộng sang `BUSINESS_ADMIN` dù permission khác cùng nhóm (`audit.user.read` — xem lịch sử 1 tài khoản) đã cấp cho cả 2 role; đây là 2 permission tách biệt, phạm vi khác nhau (1 tài khoản vs toàn hệ thống).

### 0.5. Không trả `old_value_json`/`new_value_json`/`metadata_json` trong danh sách — đã duyệt

Normal Flow bước 3 chỉ liệt kê đúng 5 cột hiển thị (Timestamp/Actor/Action/Entity/Status), không có bước xem chi tiết/drill-down nào (khác AF1 của UC-AA-10). **Quyết định đã duyệt**: response danh sách chỉ trả đúng 5 trường tương ứng, không trả `old_value_json`/`new_value_json`/`metadata_json` — giữ payload nhẹ cho phân trang, tránh lộ payload tiềm ẩn lớn/nhạy cảm ra ngoài phạm vi yêu cầu.

### 0.6. Actor hiển thị khi `user_id IS NULL`

Hành động do hệ thống/cron thực hiện có `audit_logs.user_id = NULL`. **Quyết định**: trả `actorUserId=null`, `actorName="Hệ thống"` (nhãn cố định phía backend, không để FE tự suy diễn).

### 0.7. "Đối tượng tác động" — không resolve tên thân thiện

**Quyết định**: chỉ trả `entityType` (string thô) + `entityId` (UUID thô), không JOIN sang từng bảng nghiệp vụ để lấy tên hiển thị (vd tên cuộc họp, tên phòng) — `entity_type` trải dài hàng chục bảng khác nhau trong hệ thống, resolve tên riêng từng loại vượt phạm vi Normal Flow và không được yêu cầu.

### 0.8. Sắp xếp cố định, không cho đổi chiều

POST-1 ghi rõ "sắp xếp đúng trình tự thời gian giảm dần" như 1 ràng buộc, không phải tùy chọn. **Quyết định**: luôn `ORDER BY created_at DESC`, không có tham số `sortOrder`.

### 0.9. Không giới hạn khoảng thời gian truy vấn (`from`/`to`)

Khác các feature `analytics.*` (giới hạn bởi `analytics.dashboard_max_range_days`), đây là công cụ tra cứu bảo mật — admin có thể cần xem khoảng thời gian dài để điều tra sự cố. **Quyết định**: không áp giới hạn cứng theo số ngày, chỉ giới hạn qua phân trang (`limit` tối đa 100/trang).

### 0.10. Không tự ghi audit log cho chính hành động xem audit log

Khác mọi FR audit-logging đã có ở UC-AA-01→10 (`action_type='read_analytics_*'`), **quyết định**: hành động gọi API xem audit log **KHÔNG** tự ghi thêm 1 bản ghi `audit_logs` mới — tránh vòng lặp ghi log vô nghĩa cho chính thao tác đọc log (không phải hành vi cần audit theo tinh thần BR1, vốn tập trung vào toàn vẹn dữ liệu ghi 1 lần chứ không phải theo dõi ai đã xem log).

### 0.11. BR1 (ghi 1 lần, không bao giờ sửa) — ràng buộc write-path, đã enforce sẵn

`AuditLogsService` hiện tại không có hàm `update`/`delete` nào — đúng tinh thần BR1. **Quyết định**: feature này (đọc) tuyệt đối không thêm bất kỳ endpoint PATCH/PUT/DELETE nào cho `audit_logs`, kể cả cho SYSTEM_ADMIN.

### 0.12. Field/entity xác nhận tồn tại thật (không suy đoán)

- `AuditLogEntity`: `id, userId, actionType, entityType, entityId, oldValueJson, newValueJson, ipAddress, userAgent, requestId, createdAt, severity, metadataJson`.
- `AuditLogSeverity`: `info|warning|error|critical`.
- `UserEntity`: `id, fullName, email` — dùng LEFT JOIN để resolve `actorName` khi `user_id` khác null.
- **Không có bảng/cột nào cần thêm.** Chỉ cần seed 1 permission mới (`audit.system.read`, tên đã có sẵn trong bảng permission tổng của `API_CONTRACT`).

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `administration`, là màn hình trung tâm giám sát an ninh cho System Admin, hiển thị danh sách phân trang toàn bộ sự kiện đã ghi nhận trong `audit_logs` (đăng nhập/đăng xuất, thao tác CRUD, phê duyệt, export, v.v. từ mọi module khác trong hệ thống). Tính năng **read-only tuyệt đối** — không có bất kỳ khả năng sửa/xóa nào.

### 1.2 Mục tiêu

Cho phép System Admin xem danh sách audit log mới nhất, phân trang, và (bổ sung ngoài Normal Flow literal) thu hẹp phạm vi bằng bộ lọc thời gian/actor/loại hành động/loại đối tượng/mức độ nghiêm trọng.

### 1.3 Giá trị mang lại

- Cho System Admin: truy vết nguồn gốc thao tác dữ liệu và lịch sử đăng nhập phục vụ điều tra sự cố bảo mật, tuân thủ audit trail.

### 1.4 Giả định

- Cột "Trạng thái" hiển thị đúng `severity` — §0.3.
- Chỉ `SYSTEM_ADMIN` truy cập được — §0.4.
- Danh sách không trả JSON chi tiết (`old/new/metadata`) — §0.5.
- Bộ lọc là bổ sung hợp lý ngoài Normal Flow literal, không bắt buộc phải dùng — §0.2.
- Không giới hạn khoảng thời gian truy vấn theo số ngày — §0.9.
- Không tự ghi audit log cho chính hành động xem — §0.10.

### 1.5 Clarifications Resolved

Toàn bộ điểm mơ hồ đã liệt kê và người dùng duyệt (4 quyết định chính: bổ sung bộ lọc, map cột Trạng thái vào severity, phạm vi role chỉ SYSTEM_ADMIN, không trả JSON chi tiết), cùng các phương án khuyến nghị còn lại không bị phản đối — tổng hợp tại §0.1–§0.11.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| System Admin | Quản trị viên hệ thống | Xem toàn bộ audit log hệ thống, không giới hạn phạm vi |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ: `SYSTEM_ADMIN` (duy nhất — §0.4).
- Permission bắt buộc: `audit.system.read` (permission đã có tên sẵn trong `API_CONTRACT`, chưa từng seed — cần task seed mới).
- Không có khái niệm scope/phòng ban — audit log là toàn hệ thống, không phân theo tổ chức.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `audit.system.read`.
- Không có actor nào khác được truy cập (kể cả Manager/Business Admin) trừ khi RBAC được cấu hình lại thủ công sau này (ngoài phạm vi feature).

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL trả về danh sách audit log dưới dạng read-only tuyệt đối — không tạo/sửa/xóa bất kỳ bản ghi nào trong `audit_logs` khi phục vụ yêu cầu này.

FR-002: THE system SHALL KHÔNG cung cấp bất kỳ endpoint PATCH/PUT/DELETE nào cho `audit_logs` (§0.11, BR1).

FR-003: THE system SHALL luôn sắp xếp danh sách theo `created_at` giảm dần, không có tham số đổi chiều sắp xếp (§0.8).

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi yêu cầu GET /api/v1/audit-logs, THE system SHALL kiểm tra authentication và permission `audit.system.read` trước khi xử lý logic khác.

FR-005: WHEN người dùng không truyền `page`/`limit`, THE system SHALL mặc định `page=1`, `limit=20`.

FR-006: WHEN người dùng truyền `page`/`limit` hợp lệ, THE system SHALL phân trang theo đúng giá trị đó (`limit` tối đa `100`).

FR-007: WHEN người dùng không truyền bất kỳ bộ lọc nào, THE system SHALL trả về toàn bộ `audit_logs` (không lọc), mới nhất trước, đúng Normal Flow bước 2.

FR-008: WHEN người dùng truyền `from`/`to`, THE system SHALL lọc `created_at BETWEEN from AND to`.

FR-009: WHEN người dùng truyền `userId`, THE system SHALL lọc `audit_logs.user_id = userId`.

FR-010: WHEN người dùng truyền `actionType`, THE system SHALL lọc chính xác `audit_logs.action_type = actionType`.

FR-011: WHEN người dùng truyền `entityType`, THE system SHALL lọc chính xác `audit_logs.entity_type = entityType`.

FR-012: WHEN người dùng truyền `severity`, THE system SHALL lọc chính xác `audit_logs.severity = severity`.

FR-013: WHEN nhiều bộ lọc được truyền cùng lúc, THE system SHALL áp dụng kết hợp AND giữa tất cả điều kiện.

### 3.3 State-driven Requirements

FR-014: WHILE `audit_logs.user_id IS NULL` (hành động hệ thống/service), THE system SHALL trả `actorUserId=null`, `actorName="Hệ thống"` (§0.6).

FR-015: WHILE tổ hợp bộ lọc không khớp bất kỳ bản ghi nào, THE system SHALL trả về danh sách rỗng (`data=[]`, `meta.total=0`) mà KHÔNG có `message` đặc biệt (UC gốc không định nghĩa Exceptions cho trường hợp này).

### 3.4 Optional Feature Requirements

FR-016: WHERE bộ lọc (`from/to/userId/actionType/entityType/severity`) được cung cấp, THE system SHALL áp dụng như điều kiện bổ sung (§0.2), không thay đổi hành vi mặc định khi không truyền.

### 3.5 Unwanted Behavior Requirements

FR-017: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.

FR-018: IF người dùng không có permission `audit.system.read`, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.

FR-019: IF `page`/`limit` không hợp lệ (không phải số nguyên dương, `limit` vượt `100`), THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-020: IF `from`/`to` sai định dạng ISO date, hoặc `from > to`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-021: IF `userId` không phải UUID hợp lệ, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-022: IF `severity` không thuộc {info, warning, error, critical}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

### 3.6 Authorization Requirements

FR-023: WHEN the user performs a protected action (xem audit logs), THE system SHALL verify authentication và authorization trước khi thực thi truy vấn.

FR-024: THE system SHALL KHÔNG áp bất kỳ scope phòng ban/tổ chức nào — permission `audit.system.read` cấp quyền xem toàn bộ hệ thống nếu có.

### 3.7 Data & State Requirements

FR-025: WHEN trả về mỗi bản ghi, THE system SHALL bao gồm đúng 5 trường hiển thị: `createdAt` (Timestamp), `actorUserId`/`actorName` (Người thực hiện), `actionType` (Hành động), `entityType`/`entityId` (Đối tượng tác động), `severity` (Trạng thái) — KHÔNG bao gồm `oldValueJson`/`newValueJson`/`metadataJson`/`ipAddress`/`userAgent`/`requestId` (§0.5, §0.7).

FR-026: WHEN resolving `actorName`, THE system SHALL LEFT JOIN `users` theo `audit_logs.user_id = users.id`, lấy `users.full_name`; nếu `user_id IS NULL` → áp dụng FR-014.

FR-027: WHEN trả về `meta` phân trang, THE system SHALL bao gồm `page`, `limit`, `total` (tổng số bản ghi khớp filter), `totalPages`.

### 3.8 Notification / Audit Requirements

FR-028: THE system SHALL KHÔNG tự ghi thêm bản ghi `audit_logs` mới cho chính hành động gọi API xem audit log này (§0.10) — khác pattern audit-logging đã dùng ở mọi feature `analytics.*` trước đó.

### 3.9 Complex / Combined Requirements

Không áp dụng — feature này không có logic phức tạp kết hợp nhiều điều kiện scope như các UC-AA khác (không có khái niệm scope Manager).

### 3.10 Traceability

| Requirement ID | EARS Pattern | Nguồn |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-AA-11 POST-2, BR1, §0.8, §0.11 |
| FR-004–FR-013 | Event-driven | UC-AA-11 Normal Flow bước 1-5, §0.2 |
| FR-014, FR-015 | State-driven | §0.6, UC-AA-11 Exceptions=N/A |
| FR-016 | Optional Feature | §0.2 |
| FR-017–FR-022 | Unwanted Behavior | Validation chuẩn |
| FR-023, FR-024 | Authorization | UC-AA-11 Primary Actor, §0.4 |
| FR-025–FR-027 | Data & State | UC-AA-11 Normal Flow bước 3, §0.3, §0.5-§0.7 |
| FR-028 | Notification/Audit | §0.10 |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về trang đầu tiên (không lọc) trong vòng dưới 2 giây trong điều kiện tải bình thường, tận dụng index sẵn có `ix_audit_logs_created`.

NFR-002: THE system SHALL sử dụng index sẵn có trên `audit_logs(created_at)`, `audit_logs(user_id)`, `audit_logs(action_type)`, `audit_logs(entity_type, entity_id)`, `audit_logs(severity)` cho các bộ lọc tương ứng.

### 4.2 Security

NFR-003: THE system SHALL yêu cầu authentication cho mọi request.

NFR-004: THE system SHALL enforce permission `audit.system.read` ở tầng guard/service, không chỉ dựa vào FE.

NFR-005: THE system SHALL KHÔNG bao giờ cho phép sửa/xóa `audit_logs` qua bất kỳ API nào (BR1).

### 4.3 Reliability & Consistency

NFR-006: THE system SHALL đảm bảo `meta.total` phản ánh đúng số bản ghi khớp filter tại thời điểm truy vấn (không cache).

### 4.4 Usability

NFR-007: THE system SHALL trả về clear error messages và field names dạng camelCase.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `audit_logs` | Nguồn dữ liệu duy nhất | Chỉ đọc, không JOIN business entity theo `entity_type` (§0.7) |
| `users` | Resolve `actorName` | LEFT JOIN qua `user_id`, fallback "Hệ thống" nếu null |

### 5.2 Dữ liệu đầu vào

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| page | integer | Không | Mặc định `1` | Số nguyên dương |
| limit | integer | Không | Mặc định `20` | Số nguyên dương, tối đa `100` |
| from | date (ISO 8601) | Không | Lọc `created_at >= from` | ISO date |
| to | date (ISO 8601) | Không | Lọc `created_at <= to` | ISO date, `to >= from` |
| userId | UUID | Không | Lọc theo người thực hiện | UUID hợp lệ |
| actionType | string | Không | Lọc chính xác loại hành động | max 80 ký tự |
| entityType | string | Không | Lọc chính xác loại đối tượng | max 80 ký tự |
| severity | string | Không | `info`/`warning`/`error`/`critical` | Enum hợp lệ |

### 5.3 Dữ liệu đầu ra

| Field | Type | Mô tả |
|---|---:|---|
| data[].id | UUID | Khóa chính audit log |
| data[].createdAt | timestamptz | Timestamp |
| data[].actorUserId | UUID \| null | Người thực hiện (null nếu hệ thống) |
| data[].actorName | string | Tên hiển thị, `"Hệ thống"` nếu `actorUserId=null` |
| data[].actionType | string | Hành động |
| data[].entityType | string | Loại đối tượng tác động |
| data[].entityId | UUID \| null | ID đối tượng tác động |
| data[].severity | string | Trạng thái (`info`/`warning`/`error`/`critical`) |
| meta.page/limit/total/totalPages | integer | Thông tin phân trang |

### 5.4 Data Constraints

- Không ghi/sửa/xóa `audit_logs` qua feature này (FR-001, FR-002).
- Không thêm bảng/cột mới — chỉ seed 1 permission đã có tên sẵn.
- Không trả `oldValueJson`/`newValueJson`/`metadataJson`/`ipAddress`/`userAgent`/`requestId` trong response (§0.5).

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN liệt kê audit logs, THE system SHALL LEFT JOIN `users` để resolve `actorName`, KHÔNG JOIN bất kỳ bảng nghiệp vụ nào khác theo `entity_type` (§0.7).

### 5.6 Cần làm rõ

- **CL-1**: `docs/API_CONTRACT_v1.0_with_system_roles.md` chưa có mục UC-1xx chính thức cho endpoint `GET /api/v1/audit-logs` — đề xuất bổ sung 1 mục mới vào `API_CONTRACT` ở task tài liệu riêng để đồng bộ (feature này là nguồn chuẩn đầu tiên).
- **CL-2**: Nếu sau này cần drill-down xem `old_value_json`/`new_value_json` chi tiết cho 1 bản ghi cụ thể, cần thêm endpoint `GET /api/v1/audit-logs/{id}` riêng — hiện ngoài phạm vi (§0.5).
- **CL-3**: Nếu business quyết định mở quyền cho `BUSINESS_ADMIN` sau này, chỉ cần thêm bản ghi `role_permissions` mới (không cần sửa code) — permission model đã đủ linh hoạt.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `page`/`limit` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `from`/`to` sai định dạng hoặc `from > to`, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `userId` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF `severity` không hợp lệ, THEN 400 `VALIDATION_ERROR`.

### 6.2 Authentication / Authorization Errors

ERR-005: IF chưa đăng nhập, THEN 401.
ERR-006: IF không có permission `audit.system.read`, THEN 403 `PERMISSION_DENIED`.

### 6.3 System Errors

ERR-007: IF lỗi truy vấn hệ thống, THEN 500 `INTERNAL_ERROR`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given System Admin đã đăng nhập,
When gọi API không tham số,
Then hệ thống trả về trang 1, `limit=20`, sắp xếp `created_at` giảm dần, đúng 5 trường hiển thị mỗi bản ghi.

AC-002:
Given tồn tại 45 bản ghi audit log,
When gọi API với `page=2&limit=20`,
Then hệ thống trả về đúng 20 bản ghi tiếp theo (bản ghi thứ 21-40), `meta.total=45`, `meta.totalPages=3`.

AC-003:
Given 1 bản ghi có `user_id=NULL` (hành động cron tự động),
When gọi API,
Then bản ghi đó hiển thị `actorUserId=null`, `actorName="Hệ thống"`.

### 7.2 Validation & Authorization Cases

AC-004:
Given user không có permission `audit.system.read`,
When gọi API,
Then hệ thống reject 403 `PERMISSION_DENIED`.

AC-005:
Given `severity=unknown_value`,
When gọi API,
Then hệ thống reject 400 `VALIDATION_ERROR`.

### 7.3 Business Rule Cases

AC-006:
Given bộ lọc `actionType=login&severity=critical` không khớp bất kỳ bản ghi nào,
When gọi API,
Then `data=[]`, `meta.total=0`, KHÔNG có trường `message` nào kèm theo.

AC-007:
Given bất kỳ request nào,
When gọi API thành công,
Then hệ thống KHÔNG tạo thêm bản ghi `audit_logs` mới cho chính request đó (verify FR-028).

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-003, FR-005, FR-025 |
| AC-002 | FR-006, FR-027 |
| AC-003 | FR-014, FR-026 |
| AC-004 | FR-018, ERR-006 |
| AC-005 | FR-022, ERR-004 |
| AC-006 | FR-015 |
| AC-007 | FR-028 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Endpoint xem chi tiết 1 bản ghi (`old_value_json`/`new_value_json`/`metadata_json`) — CL-2.
- Bất kỳ endpoint sửa/xóa `audit_logs` nào — vi phạm BR1 (§0.11).
- Resolve tên thân thiện cho `entityId` theo từng loại `entity_type` — §0.7.
- Mở quyền cho `BUSINESS_ADMIN`/`MANAGER` — chỉ `SYSTEM_ADMIN` (§0.4).
- Giới hạn cứng khoảng thời gian truy vấn (`from`/`to`) theo kiểu `analytics.dashboard_max_range_days` — §0.9.
- Tự ghi audit log cho chính hành động xem audit log — §0.10.
- Export/xuất báo cáo audit log (nếu cần, UC riêng — UC-AA-12 xuất báo cáo tổng hợp có thể liên quan nhưng ngoài phạm vi UC-AA-11).
- WebSocket push/invalidate.

### 8.2 Có thể xem xét ở feature khác

- Bổ sung `API_CONTRACT_v1.0_with_system_roles.md` với endpoint mới này (CL-1).
- Endpoint chi tiết `GET /api/v1/audit-logs/{id}` nếu phát sinh yêu cầu drill-down (CL-2).
- Mở quyền `BUSINESS_ADMIN` qua cấu hình role_permissions nếu business yêu cầu sau (CL-3).

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT provide any PATCH/PUT/DELETE endpoint for audit_logs.
OOS-002: THE system SHALL NOT return oldValueJson/newValueJson/metadataJson in the list response.
OOS-003: THE system SHALL NOT resolve entityId into a business-friendly display name.
OOS-004: THE system SHALL NOT write a new audit_logs entry for the act of reading audit logs via this feature.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements viết theo EARS, đủ 5 pattern cơ bản (Complex không áp dụng, đã ghi rõ lý do).
- [x] Mỗi requirement có mã ID rõ ràng, có traceability.
- [x] Error handling bao gồm validation, authentication, authorization, system error.
- [x] Acceptance Criteria dùng Given/When/Then.
- [x] Out of Scope có EARS guardrails.
- [x] Không tự ý thêm bảng/cột database mới (chỉ seed 1 permission đã có tên sẵn).
- [x] Các điểm thiếu thông tin đưa vào mục 5.6 "Cần làm rõ".
