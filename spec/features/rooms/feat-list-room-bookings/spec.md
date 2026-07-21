# Feature Specification: Xem danh sách toàn bộ booking phòng hiện tại

- **Feature ID**: ROOM-BOOKING-LIST-001
- **Feature Name**: Xem danh sách toàn bộ booking phòng hiện tại (List Room Bookings)
- **Module / Domain**: rooms
- **Created Date**: 2026-07-20
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables)
  - AGENTS.md / CLAUDE.md backend guide
  - .specify/templates/spec-template.md
  - src/modules/rooms/entities/room-booking.entity.ts
  - spec.md cua feat-pending-meeting-requests (list endpoint reference)
  - spec.md cua feat-search-room-list (rooms module precedent)

---

## CHANGELOG & REVISION HISTORY
| Ngay cap nhat | Tom tat thay doi | Cac dong thay doi |
| :--- | :--- | :--- |
| 2026-07-20 | Tao moi spec cho feature feat-list-room-bookings | Toan bo file |
| 2026-07-20 | Giai quyet 2 diem "Can lam ro": chon Manager scope Option A (tai su dung scope rule FR-032 cua feat-pending-meeting-requests: bookedBy.directManagerId/department.managerUserId), xac nhan permission room.booking.read dung convention. Sua loi format (ky tu "r" thua thay cho dau phan cach "---"). | Muc 1.4, 1.5, 2.1, 2.2, FR-012, FR-029, 3.9 traceability, 5.7, AC-013, 7.6 traceability, checklist cuoi file |

---

## 1. Context & Goal

### 1.1 Boi canh

Feature nay cung cap API cho SYSTEM_ADMIN / BUSINESS_ADMIN / MANAGER xem danh sach toan bo room bookings tren he thong, khong gioi han theo user cu the.

Hien tai backend da co GET /me/schedule (chi lich cua user hien tai) va GET /meeting-requests (danh sach yeu cau, chua phai booking da confirm), nhung KHONG co endpoint nao tra ve toan bo room_bookings tren he thong cho admin/manager xem tong quan. Day la feature moi can dac ta.

Feature nay thuoc module rooms, giai doan pre-meeting va ongoing-meeting, phuc vu muc dich quan tri va giam sat dat phong.

### 1.2 Muc tieu

Muc tieu cua tinh nang nay la cho phep SYSTEM_ADMIN / BUSINESS_ADMIN / MANAGER xem va tra cuu danh sach toan bo room bookings trong he thong, voi cac bo loc linh hoat va phan trang, nham ho tro quan tri vien giam sat tinh trang dat phong tong the.

### 1.3 Gia tri mang lai

- Giup admin/manager co cai nhin tong quan ve tat ca booking phong tren he thong.
- Ho tro loc va tim kiem linh hoat theo phong, trang thai, loai booking, khoang thoi gian.
- Phan trang va sort giam tai cho UI va de dang tich hop vao danh sach quan tri.
- Gioi han du lieu theo pham vi role (admin thay toan bo, manager thay theo scope phong ban), dam bao an toan thong tin.
- Tra relation summary (room, meeting, bookedByUser, approvedByUser) giam so luong API call tu client.

### 1.4 Gia dinh

- Room booking da duoc tao boi cac feature khac (feat-room-booking, live-meeting extend, relocation...).
- Permission room.booking.read la permission MOI can duoc seed trong migration o buoc implement sau. Ten permission tuan thu dung convention <module>.<resource>.<action> da dung cho rooms (room.noshow.read, room.utilization.read) nen khong con diem can thong nhat them.
- Manager scope trong v1: Manager thay booking cua nhung user (bookedBy) thuoc pham vi quan ly cua ho, dung chinh xac scope rule da duoc duyet va implement o feat-pending-meeting-requests (FR-032) cho meeting_requests.requested_by. Xem FR-012/FR-029 va AC-013.
- RoomEntity khong co department_id (phong hop la tai nguyen dung chung toan to chuc, khong thuoc so huu phong ban nao) — do do scope KHONG loc theo "phong thuoc phong ban nao" ma loc theo phong ban cua nguoi dat (bookedBy), giong het cach feat-pending-meeting-requests da lam voi requestedBy.
- API tuan thu convention /api/v1, response chuan success/data/meta/error.
- Pagination dung page, limit, sortBy, sortOrder theo convention chung (CLAUDE.md muc 8.4).
- Chi ho tro sort theo allowlist de tranh SQL injection.
- Khong ghi audit log cho hanh dong doc du lieu.

### 1.5 Can lam ro (da giai quyet)

- **[DA GIAI QUYET]** Manager scope: chon Option A (trong 3 option de xuat ban dau), ap dung dung scope rule da duyet o feat-pending-meeting-requests FR-032, khong bia them bang/cot moi:
  - Manager thay booking co bookedBy.directManagerId = currentUser.id, HOAC
  - Manager thay booking co bookedBy thuoc department co managerUserId = currentUser.id.
  - Neu khong co booking nao trong scope, tra 200 voi data = [] (khong fallback toan to chuc), giong AC-006 cua feat-pending-meeting-requests.
  - Option B (manager xem het nhu admin) va Option C (defer, chi admin xem) bi loai vi Option A tai su dung duoc pattern/code da co san o meeting-request-review.service.ts, khong lam giam muc do kiem soat du lieu nhu Option B, va khong defer scope ma van dam bao tinh nang du dung cho manager tu v1.
- **[DA GIAI QUYET]** Permission room.booking.read: giu nguyen ten, da khop dung convention <module>.<resource>.<action> hien co (room.noshow.read, room.utilization.read, room.create...). Khong co lua chon ten nao khac can can nhac; chi con buoc seed migration o giai doan implement (xem OOS-004).
---

## 2. Actor & Roles

### 2.1 Danh sach actor

| Actor | Vai tro trong tinh nang | Quyen / Trach nhiem chinh |
|---|---|---|
| SYSTEM_ADMIN | Xem toan bo room bookings khong gioi han | Can permission room.booking.read |
| BUSINESS_ADMIN | Xem toan bo room bookings khong gioi han | Can permission room.booking.read |
| MANAGER | Xem booking cua user thuoc pham vi quan ly (bookedBy.directManagerId = currentUser.id, hoac bookedBy thuoc department co managerUserId = currentUser.id) | Can permission room.booking.read |

### 2.2 Role & Permission Rules

- User co permission room.booking.read duoc phep truy cap API nay.
- SYSTEM_ADMIN va BUSINESS_ADMIN duoc xem toan bo booking khong gioi han.
- MANAGER scope (da giai quyet, xem muc 1.5): chi thay booking co bookedBy.directManagerId = currentUser.id, HOAC bookedBy thuoc department co managerUserId = currentUser.id. Neu khong co booking nao trong scope, tra 200 voi data = [].
- Employee / regular user khong co quyen truy cap endpoint nay (chi xem lich ca nhan qua /me/schedule).
- Permission format: room.booking.read (theo convention <module>.<resource>.<action> da dung cho rooms: room.noshow.read, room.utilization.read).

### 2.3 Actor Constraints

- Phai dang nhap (authenticated) truoc khi truy cap API.
- Phai co permission room.booking.read.
- Scope constraint (Manager) ap dung sau permission check.
- Neu khong co booking nao trong scope, tra 200 voi data = [] (khong fallback toan to chuc).

---

## 3. Functional Requirements

> Tat ca Functional Requirements viet theo EARS.
> Keyword EARS giu bang tieng Anh. Noi dung nghiep vu viet bang tieng Viet.

### 3.1 Core Requirements (Ubiquitous)

FR-001: THE system SHALL yeu cau nguoi dung dang nhap truoc khi truy cap API danh sach room bookings.
FR-002: THE system SHALL yeu cau nguoi dung co permission room.booking.read de truy cap API nay.
FR-003: THE system SHALL tra ve danh sach room bookings dua tren bang room_bookings cua Database v3.2 Compact.
FR-004: THE system SHALL ho tro phan trang voi cac tham so page, limit, sortBy, sortOrder theo API convention cua du an (CLAUDE.md muc 8.4).

### 3.2 Event-driven Requirements (Query & Response)

FR-005: WHEN client gui request GET /api/v1/room-bookings, THE system SHALL ap dung cac bo loc theo query parameters va tra danh sach phu hop.
FR-006: WHEN client truyen roomId, THE system SHALL loc booking co room_id tuong ung.
FR-007: WHEN client truyen status, THE system SHALL loc theo gia tri tuong ung: pending, approved, active, completed, cancelled, released.
FR-008: WHEN client truyen bookingType, THE system SHALL loc theo gia tri tuong ung: scheduled, ad_hoc, extension, relocated.
FR-009: WHEN client truyen from va/hoac to, THE system SHALL loc booking co reserved_start_time nam trong khoang thoi gian tuong ung.
FR-010: WHEN client truyen q, THE system SHALL tim kiem theo booking_code, case-insensitive, partial match. Trong v1 khong search qua room.roomName, meeting.title, hoac bookedByUser.fullName.

### 3.3 State-driven Requirements

FR-011: WHILE nguoi dung la SYSTEM_ADMIN hoac BUSINESS_ADMIN, THE system SHALL cho phep xem toan bo booking khong gioi han.
FR-012: WHILE nguoi dung la MANAGER, THE system SHALL gioi han ket qua chi bao gom booking co bookedBy.directManagerId = currentUser.id, HOAC bookedBy thuoc department co managerUserId = currentUser.id (cung scope rule da dung o feat-pending-meeting-requests FR-032).

### 3.4 Sorting Requirements

FR-013: WHEN client khong truyen sortBy va sortOrder, THE system SHALL mac dinh sort theo reserved_start_time DESC.
FR-014: WHEN client truyen sortBy, THE system SHALL kiem tra gia tri trong allowlist truoc khi ap dung.
FR-015: THE system SHALL chi cho phep sort theo cac field: reserved_start_time, created_at, status.

### 3.5 Response & Relation Requirements

FR-016: WHEN tra danh sach room bookings, THE system SHALL bao gom relation summary:
  - room: id, roomName
  - meeting: id, title (null neu khong co)
  - bookedByUser: id, fullName, email
  - approvedByUser: id, fullName, email (null neu chua duyet)
FR-017: WHEN tra danh sach room bookings, THE system SHALL bao gom cac field chinh:
  - id, bookingCode, bookingType, status
  - roomId, meetingId, bookedBy
  - reservedStartTime, reservedEndTime
  - approvedBy, approvedAt, cancellationReason
  - createdAt, updatedAt
FR-018: WHEN meeting_id la null (truong hop booking khong gan meeting), THE system SHALL tra meeting = null thay vi lam loi response.
FR-019: WHEN approved_by la null (booking chua duoc duyet), THE system SHALL tra approvedByUser = null thay vi lam loi response.
FR-020: THE system SHALL load relations bang TypeORM QueryBuilder hoac LEFT JOIN, tranh N+1 query.

### 3.6 Validation Requirements

FR-021: IF page < 1, THEN THE system SHALL tra ve loi 400 Bad Request.
FR-022: IF limit < 1 hoac limit > 100, THEN THE system SHALL tra ve loi 400 Bad Request.
FR-023: IF status khong nam trong danh sach hop le, THEN THE system SHALL tra ve loi 422 Unprocessable Entity.
FR-024: IF bookingType khong nam trong danh sach hop le, THEN THE system SHALL tra ve loi 422 Unprocessable Entity.
FR-025: IF roomId khong phai UUID hop le, THEN THE system SHALL tra ve loi 400 Bad Request.
FR-026: IF from > to, THEN THE system SHALL tra ve loi 400 Invalid date range.
FR-027: IF sortBy khong nam trong allowlist, THEN THE system SHALL tra ve loi 400 hoac 422 Invalid sort field.

### 3.7 Authorization Requirements

FR-028: IF user khong co permission room.booking.read, THEN THE system SHALL tra ve 403 Forbidden.
FR-029: IF user la MANAGER, THE system SHALL gioi han ket qua chi gom booking co bookedBy.directManagerId = currentUser.id, HOAC bookedBy thuoc department co managerUserId = currentUser.id. Neu khong co booking nao trong scope, tra 200 voi data = [] (khong fallback toan to chuc).

### 3.8 Performance & Data Requirements

FR-030: THE system SHALL dam bao query index-friendly, su dung cac index co san tren room_bookings (room_id, status, booking_type, reserved_start_time, booked_by).
FR-031: THE system SHALL khong tra password, token, password_hash, hoac PII khong can thiet trong response.
FR-032: THE system SHALL khong ghi audit_log cho hanh dong doc du lieu (GET).

### 3.9 Traceability

| Requirement ID | EARS Pattern | Nguon / Use Case lien quan | Ghi chu |
|---|---|---|---|
| FR-001 | Ubiquitous | Authentication | Yeu cau JWT |
| FR-002 | Ubiquitous | Permission check | room.booking.read (MOI) |
| FR-003 | Ubiquitous | Database v3.2 Compact | Bang room_bookings |
| FR-005 | Event-driven | Query handling | Filter theo query params |
| FR-011 | State-driven | Admin scope | SYSTEM_ADMIN / BUSINESS_ADMIN |
| FR-012 | State-driven | Manager scope | directManagerId + department.managerUserId, giong FR-032 feat-pending-meeting-requests |
| FR-021 | Unwanted Behavior | Validation | Page/limit invalid |
---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL tra response danh sach room bookings trong vong 3 giay duoi tai binh thuong (duoi 10.000 booking).
NFR-002: THE system SHALL ho tro it nhat 50 yeu cau doc danh sach dong thoi ma khong suy giam hieu suat nghiem trong.
NFR-003: THE system SHALL su dung database index tren cac field thuong duoc dung de loc (room_id, status, booking_type, reserved_start_time) de dam bao query performance.

### 4.2 Security

NFR-004: THE system SHALL yeu cau authentication truoc khi cho phep truy cap API.
NFR-005: THE system SHALL kiem tra authorization (permission room.booking.read) cho moi request.
NFR-006: THE system SHALL khong tiet lo thong tin nhay cam (password, token) trong response.
NFR-007: THE system SHALL validate sortBy theo allowlist de tranh SQL/QueryBuilder injection.

### 4.3 Reliability & Consistency

NFR-008: THE system SHALL tra du lieu nhat quan giua cac request trong cung phien lam viec.
NFR-009: THE system SHALL tra pagination meta (page, limit, total, totalPages) chinh xac.

### 4.4 Usability

NFR-010: THE system SHALL tra error message ro rang, co the hieu duoc boi client.
NFR-011: THE system SHALL su dung response format thong nhat theo project convention (success/data/meta/error).

### 4.5 Maintainability

NFR-012: THE system SHALL giu business logic trong module rooms, khong tron lan voi module khac.
NFR-013: THE system SHALL cung cap test cases cho success flow, validation failure, authorization failure, va data scope filtering.

---

## 5. Data Model

### 5.1 Entity lien quan

| Entity / Table | Vai tro trong tinh nang | Ghi chu |
|---|---|---|
| room_bookings | Bang chinh chua du lieu booking | booking_type, status, room_id, meeting_id, booked_by, reserved_start_time, reserved_end_time,... |
| rooms | Relation summary: room | LEFT JOIN, chi lay id, room_name |
| meetings | Relation summary: meeting | LEFT JOIN, chi lay id, title |
| users | Relation summary: bookedByUser / approvedByUser | LEFT JOIN, chi lay id, full_name, email |

### 5.2 Query Parameters (dau vao)

| Parameter | Type du kien | Bat buoc | Mo ta | Validation |
|---|---:|---:|---|---|
| page | integer | Khong (mac dinh 1) | So trang | >= 1 |
| limit | integer | Khong (mac dinh 20) | So luong item/trang | 1 <= limit <= 100 |
| roomId | uuid | Khong | ID phong | UUID valid |
| status | string | Khong | Trang thai booking | pending, approved, active, completed, cancelled, released |
| bookingType | string | Khong | Loai booking | scheduled, ad_hoc, extension, relocated |
| from | ISO 8601 | Khong | Thoi gian bat dau (loc theo reservedStartTime) | from <= to |
| to | ISO 8601 | Khong | Thoi gian ket thuc (loc theo reservedStartTime) | from <= to |
| q | string | Khong | Tu khoa tim kiem | Tim theo booking_code, case-insensitive, partial match. Khong search qua relation fields trong v1 |
| sortBy | string | Khong (mac dinh reserved_start_time) | Field de sort | Allowlist: reserved_start_time, created_at, status |
| sortOrder | string | Khong (mac dinh desc) | Thu tu sort | asc, desc |

### 5.3 Response Data (dau ra)

Moi item trong danh sach:

| Field | Type du kien | Mo ta |
|---|---:|---|
| id | uuid | ID cua room booking |
| bookingCode | string | Ma booking |
| bookingType | string | Loai booking: scheduled, ad_hoc, extension, relocated |
| status | string | Trang thai: pending, approved, active, completed, cancelled, released |
| roomId | uuid | ID phong |
| meetingId | uuid | ID cuoc hop |
| bookedBy | uuid | ID nguoi dat |
| reservedStartTime | ISO 8601 | Thoi gian bat dau dat phong |
| reservedEndTime | ISO 8601 | Thoi gian ket thuc dat phong |
| approvedBy | uuid (null) | ID nguoi duyet |
| approvedAt | ISO 8601 (null) | Thoi diem duyet |
| cancellationReason | string (null) | Ly do huy |
| createdAt | ISO 8601 | Thoi diem tao |
| updatedAt | ISO 8601 | Thoi diem cap nhat |
| room | object | Phong: id, roomName |
| meeting | object (null) | Cuoc hop: id, title |
| bookedByUser | object | Nguoi dat: id, fullName, email |
| approvedByUser | object (null) | Nguoi duyet: id, fullName, email |

### 5.4 State / Status Model

RoomBookingStatus:

| Status | Y nghia |
|---|---|
| pending | Dang cho duyet |
| approved | Da duoc duyet |
| active | Dang dien ra |
| completed | Da ket thuc |
| cancelled | Da huy |
| released | Da duoc giai phong (do no-show/early vacancy) |

### 5.5 Data Constraints

- room_bookings.booking_type chi chap nhan cac gia tri: scheduled, ad_hoc, extension, relocated.
- room_bookings.status chi chap nhan cac gia tri: pending, approved, active, completed, cancelled, released.
- room_bookings.meeting_id co the null (booking khong gan meeting, vi du ad_hoc).
- room_bookings.approved_by co the null (booking chua duoc duyet).
- room_bookings.booked_by khong duoc null (luon co nguoi dat).

### 5.6 Data Lifecycle

- **Tao**: Room booking duoc tao boi cac feature khac (room booking, live-meeting extension, relocation...).
- **Doc**: Feature nay chi thuc hien doc du lieu, khong thay doi.
- **Cap nhat**: Trang thai booking duoc cap nhat boi cac feature khac (approve, cancel, release, check-in/check-out).
- **Terminal states**: completed, cancelled, released.

### 5.7 Can lam ro (da giai quyet)

- **[DA GIAI QUYET]** Manager scope: khong loc theo "phong thuoc quan ly cua manager nao" (RoomEntity khong co department_id). Loc theo bookedBy.directManagerId / bookedBy.department.managerUserId, giong FR-032 cua feat-pending-meeting-requests. Xem muc 1.5, FR-012, FR-029, AC-013.
---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF page < 1, THEN THE system SHALL tra ve 400 Bad Request.
ERR-002: IF limit < 1 hoac limit > 100, THEN THE system SHALL tra ve 400 Bad Request.
ERR-003: IF status khong nam trong danh sach hop le, THEN THE system SHALL tra ve 422 Unprocessable Entity.
ERR-004: IF bookingType khong nam trong danh sach hop le, THEN THE system SHALL tra ve 422 Unprocessable Entity.
ERR-005: IF roomId khong phai UUID hop le, THEN THE system SHALL tra ve 400 Bad Request.
ERR-006: IF from > to, THEN THE system SHALL tra ve 400 Invalid date range.
ERR-007: IF sortBy khong nam trong allowlist, THEN THE system SHALL tra ve 400 Invalid sort field.

### 6.2 Authentication / Authorization Errors

ERR-008: IF user chua dang nhap (khong co JWT token hop le), THEN THE system SHALL tra ve 401 Unauthorized.
ERR-009: IF user khong co permission room.booking.read, THEN THE system SHALL tra ve 403 Forbidden.

### 6.3 System Failure Errors

ERR-010: IF database query that bai hoac timeout, THEN THE system SHALL tra ve 500 Internal Server Error.
ERR-011: IF relation loading (room/meeting/bookedByUser/approvedByUser) that bai, THEN THE system SHALL tra ve 500 Internal Server Error.

### 6.4 Error Response Expectations

Response loi theo API convention:

| Field | Mo ta |
|---|---|
| success | false |
| message | Thong bao loi co the dien giai |
| error.code | Ma loi noi bo |
| error.details | Chi tiet loi validation neu can |
| timestamp | Thoi diem xay ra loi |
| path | API path |

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001: Admin lay danh sach room bookings thanh cong
Given Admin co permission room.booking.read va trong he thong co cac booking voi nhieu trang thai khac nhau,
When Admin gui GET /api/v1/room-bookings,
Then he thong tra 200 kem danh sach booking, phan trang, sort theo reservedStartTime DESC.

AC-002: Loc theo roomId
Given he thong co booking cho phong A va phong B,
When client gui GET /api/v1/room-bookings?roomId=<roomA-uuid>,
Then he thong chi tra booking co room_id = roomA.

AC-003: Loc theo status
Given he thong co booking ca pending va active,
When client gui GET /api/v1/room-bookings?status=active,
Then he thong chi tra booking co status = active.

AC-004: Loc theo bookingType
Given he thong co booking scheduled va ad_hoc,
When client gui GET /api/v1/room-bookings?bookingType=ad_hoc,
Then he thong chi tra booking co booking_type = ad_hoc.

### 7.2 Authorization Cases

AC-005: User khong co permission room.booking.read bi tu choi
Given user khong co permission room.booking.read,
When user gui GET /api/v1/room-bookings,
Then he thong tra 403 Forbidden.

AC-006: SYSTEM_ADMIN / BUSINESS_ADMIN thay toan bo booking
Given SYSTEM_ADMIN hoac BUSINESS_ADMIN co permission room.booking.read,
When ho goi GET /api/v1/room-bookings,
Then API tra tat ca booking khong gioi han scope.

AC-013: MANAGER chi thay booking trong pham vi quan ly
Given Manager co permission room.booking.read, va he thong co booking cua user thuoc quyen quan ly (directManagerId = manager.id hoac department.managerUserId = manager.id) va booking cua user ngoai pham vi,
When Manager goi GET /api/v1/room-bookings,
Then API chi tra booking co bookedBy nam trong pham vi quan ly cua Manager, khong tra booking ngoai pham vi. Neu khong co booking nao trong scope, tra 200 voi data = [].

### 7.3 Null Relation Cases

AC-007: Booking co meeting_id = null van tra response hop le
Given mot booking co meeting_id = null (vi du bookingType = ad_hoc),
When client gui GET /api/v1/room-bookings,
Then response tra meeting = null va khong bi loi.

AC-008: Booking co approved_by = null van tra response hop le
Given mot booking co approved_by = null (chua duoc duyet),
When client gui GET /api/v1/room-bookings,
Then response tra approvedByUser = null va khong bi loi.

### 7.4 Pagination Cases

AC-009: Pagination tra dung page, limit, total, totalPages
Given he thong co tong cong 50 booking,
When client gui GET /api/v1/room-bookings?page=1&limit=20,
Then response tra 20 items tren trang 1, meta.total = 50, meta.totalPages = 3.

AC-010: Sort mac dinh la reservedStartTime DESC
Given he thong co nhieu booking voi reserved_start_time khac nhau,
When client goi GET /api/v1/room-bookings,
Then response sort theo reserved_start_time giam dan.

### 7.5 Validation Cases

AC-011: Invalid enum tra loi validation chuan
Given client gui request voi status khong hop le,
When client gui GET /api/v1/room-bookings?status=invalid,
Then he thong tra 422 Unprocessable Entity.

AC-012: limit vuot max bi reject
Given client gui request voi limit > 100,
When client gui GET /api/v1/room-bookings?limit=200,
Then he thong tra 400 Bad Request.

### 7.6 Acceptance Criteria Traceability

| AC ID | Requirement ID lien quan | Kich ban test chinh |
|---|---|---|
| AC-001 | FR-001, FR-002, FR-005, FR-013 | Admin xem danh sach bookings |
| AC-002 | FR-006 | Filter by roomId |
| AC-003 | FR-007 | Filter by status |
| AC-004 | FR-008 | Filter by bookingType |
| AC-005 | FR-002, FR-028, ERR-009 | No permission |
| AC-006 | FR-011 | Admin scope |
| AC-007 | FR-018 | Null meeting |
| AC-008 | FR-019 | Null approvedBy |
| AC-009 | FR-004 | Pagination |
| AC-010 | FR-013 | Default sort |
| AC-011 | FR-023, ERR-003 | Invalid enum |
| AC-012 | FR-022, ERR-002 | Limit vuot max |
| AC-013 | FR-012, FR-029 | Manager scope: directManagerId + department.managerUserId |
---

## 8. Out of Scope

### 8.1 Khong trien khai trong feature nay

- Khong tao booking moi.
- Khong approve/cancel/release booking.
- Khong xem chi tiet 1 booking don le (GET /room-bookings/:id).
- Khong gui notification.
- Khong tao migration database (permission seed la migration rieng, nhung spec chi de xuat).
- Khong them bang/cot moi.
- Khong ghi audit log cho hanh dong doc.
- Khong export danh sach booking ra file.
- Khong summary/thong ke so luong booking.

### 8.2 Co the xem xet o feature khac

- Chi tiet mot room booking (GET /api/v1/room-bookings/:id) - co the tach thanh feature rieng.
- Export danh sach booking ra Excel/CSV - thuoc feature report/export.
- Thong ke so luong booking theo trang thai - thuoc feature analytics/dashboard.
- WebSocket realtime push khi co booking moi - thuoc feature realtime infrastructure.

### 8.3 Out-of-scope EARS Guardrails

OOS-001: THE system SHALL NOT tao, cap nhat, approve, cancel, hoac release booking trong feature nay.
OOS-002: THE system SHALL NOT them bang database moi hoac su dung bang da bi loai bo khoi DB v3.2 Compact.
OOS-003: THE system SHALL NOT gui email, notification, hoac WebSocket event trong feature nay.
OOS-004: THE system SHALL NOT tao migration hoac thay doi schema database (permission seed la migration rieng).
OOS-005: THE system SHALL NOT implement single booking detail endpoint (GET /api/v1/room-bookings/:id) trong feature nay.
OOS-006: THE system SHALL NOT tao booking moi hoac thay doi trang thai booking.

---

## Checklist tu kiem tra truoc khi hoan tat spec

- [x] Functional Requirements da dung EARS.
- [x] Co du 5 EARS patterns: Ubiquitous, Event-driven, State-driven, Unwanted Behavior, Authorization.
- [x] Moi requirement co ma ID ro rang.
- [x] Co du validation, authorization, response relation requirements.
- [x] Da xu ly null relation cho meeting va approvedByUser.
- [x] Co pagination, sorting, filtering requirements.
- [x] Khong tu y them bang moi.
- [x] Khong dung bang da bi xoa khoi DB v3.2 Compact.
- [x] Khong trien khai out-of-scope noi dung.
- [x] Co AC traceability.
- [x] Co Out of Scope ro rang.
- [x] Manager scope da giai quyet (Option A, tai su dung scope rule FR-032 cua feat-pending-meeting-requests), khong con "Can lam ro" cho ky implement.

