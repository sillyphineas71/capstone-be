# Feature Specification: Xem danh sách người tham dự đang có mặt (View Live Meeting Participants)

- **Feature ID**: UC-IMM-07
- **Feature Name**: Xem danh sách người tham dự đang có mặt
- **Module / Domain**: live-meeting
- **Use Case**: UC-100 (API Contract), UC-IMM-07
- **Created Date**: 2026-06-17
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables)
  - AGENTS.md - Backend Agent Guide v1.1
  - API_CONTRACT_v1.0_with_system_roles.md (UC-100)
  - SPEC_ALIGNMENT_WITH_DB_V3_2_COMPACT.md
  - spec/features/live-meeting/feat-request-meeting-extension/spec.md (feature lien quan)

---

## CHANGELOG & REVISION HISTORY
| Ngay cap nhat | Tom tat thay doi | Cac dong thay doi |
| :--- | :--- | :--- |
| 2026-06-17 | Cap nhat spec sau khi lam ro (Clarifications Session): loai bo logic online, gioi han quyen Manager, lam ro `joinedAt` va grace window | Nhieu muc |
| 2026-06-17 | Tao spec lan dau cho UC-IMM-07 Xem danh sach nguoi tham du dang co mat | Toan bo file |

---

## Huong dan viet EARS Requirements

Functional Requirements trong spec nay viet theo EARS.
Keyword EARS giu nguyen bang tieng Anh. Noi dung nghiep vu viet bang tieng Viet.

| Keyword | Vai tro |
|---|---|
| `THE system SHALL` | Yeu cau luon dung, khong phu thuoc event/state/option/error |
| `WHEN` | Trigger/event xay ra tai mot thoi diem |
| `WHILE` | Hanh vi dung trong suot mot trang thai |
| `WHERE` | Yeu cau chi ap dung khi feature/capability/config ton tai |
| `IF ... THEN` | Xu ly loi, ngoai le, dieu kien khong mong muon |

---

## 1. Context & Goal

### 1.1 Boi canh

Tinh nang UC-IMM-07 thuoc nhom In-Meeting Management, module `live-meeting`.

Trong quy trinh meeting lifecycle, khi cuoc hop da duoc bat dau (in_progress), Host va Business Admin can kha nang theo doi realtime danh sach nguoi dang co mat trong phien hop. Viec nay phuc vu:

- Xac nhan thanh phan tham du truoc khi dua ra quyet dinh quan trong.
- Kiem tra si so truoc khi Host yeu cau gia han phien hop (lien quan UC-IMM-02).
- Giam sat phong hop realtime tu man hinh room monitoring cua Business Admin.
- Phat hien nguoi co mat vat ly tai phong (qua camera/check-in) va nguoi tham gia online (qua app login/WebSocket).

Hien tai he thong chua co co che cho phep Host hoac Admin xem realtime danh sach nguoi dang hien dien trong phien hop dang dien ra. Du lieu hien dien duoc ghi nhan tu nhieu nguon (attendance_records, presence_snapshots, attendance_events) nhung chua duoc tong hop va hien thi tap trung.

Tinh nang nay lien quan toi: actor (Host, Business Admin, Participant), meeting entity, meeting participants, attendance records, presence snapshots, rooms, room bookings, room booking usages, va audit logs.

### 1.2 Muc tieu

Muc tieu cua tinh nang nay la cho phep **Host** (cua meeting) hoac **Business Admin** xem realtime danh sach nguoi dang co mat trong phien hop, bao gom:

- Nguoi co mat vat ly tai phong (phat hien qua camera/check-in device/face attendance terminal).
- Nguoi tham gia online (da login app va join meeting session).
- Thong tin co ban: ho ten, phong ban, vai tro trong meeting, thoi gian joined, trang thai hien dien, nguon hien dien.

### 1.3 Gia tri mang lai

- **Host**: Biet chinh xac ai dang co mat truoc khi dua ra quyet dinh (bat dau, gia han, ket thuc). Kiem tra si so realtime truoc khi yeu cau gia han phien hop.
- **Business Admin**: Giam sat realtime tinh trang phong hop tu man hinh monitoring trung tam, phat hien phong dang occupied nhung khong co nguoi (potential no-show).
- **Participants**: Host co the thay duoc ai dang online/offline, ho tro quyet dinh co nen doi them hay khong.
- **Du lieu va audit**: Ghi nhan ai (Host/Admin) da xem danh sach hien dien, phuc vu audit khi can.

### 1.4 Gia dinh

- Meeting/session dang o trang thai `in_progress` (hoac `scheduled` voi `now >= start_time`).
- Du lieu presence duoc ghi nhan tu cac module khac (attendance qua face check-in, presence_snapshots qua camera/device, app login/WebSocket connection status).
- Danh sach chi bao gom internal participants (co `user_id` trong `meeting_participants`), khong bao gom external participants.
- Host duoc xac dinh qua `meetings.host_id` hoac `meeting_participants.participant_role = 'host'`.
- Khong co realtime push tu phia backend neu client chi dung polling; WebSocket la optional.
- Thoi gian tham chieu la server time.

### 1.5 Can lam ro

Da duoc lam ro tai muc Clarifications ben duoi.

---

## Clarifications

### Session 2026-06-17

- Q: Xac dinh `presenceStatus = online` khi chua co WebSocket tracking? → A: Trong phien ban hien tai, chi su dung cac trang thai thuc te tu DB: `present`, `maybe_present`, `left`, `absent`, `unknown`. Logic `online` la future scope.
- Q: Actor "Manager (direct 1 cap)" co duoc goi API xem cuoc hop khong thuoc ve minh? → A: Khong. Chi Host cua meeting do va Business Admin/System Admin moi duoc phep. Tra ve loi 403 `FORBIDDEN_LIVE_PARTICIPANTS_ACCESS` neu vi pham.
- Q: Truong `joinedAt` lay tu dau khi `presence_snapshots` khong luu lich su? → A: Uu tien: `attendance_records.check_in_time` -> event check_in/enter_room dau tien -> `meeting_participants.joined_at`. Neu chi co snapshot present thi tra null, cap nhat `lastSeenAt`.
- Q: Co gioi han thoi gian cho phep query khi meeting `scheduled`? → A: Co. Chi cho phep khi `now` thuoc khoang `[start_time, end_time + 30 minutes]`. Qua 30 phut sau end_time ma chua start thi tra loi `MEETING_NOT_IN_PROGRESS`.

---

## 2. Actor & Roles

### 2.1 Danh sach actor

| Actor | Vai tro trong tinh nang | Quyen / Trach nhiem chinh |
|---|---|---|
| Internal Employee (Host) | Nguoi chu tri cuoc hop | Xem danh sach hien dien day du, bao gom nguon va thoi gian chi tiet |
| Business Admin | Quan tri vien doanh nghiep | Xem danh sach hien dien tu man hinh room monitoring realtime |
| Internal Participant (Attendee) | Nguoi tham du thong thuong | Xem danh sach co ban, khong xem presenceSource/checkInTime cua nguoi khac |
| System Admin | Quan tri vien he thong | Xem toan bo danh sach, full detail |

### 2.2 Role & Permission Rules

- **Quyen bat buoc**: `meeting.presence.read`.
- Host cua meeting duoc xac dinh qua `meetings.host_id` hoac `meeting_participants.participant_role = 'host'`.
- Host luon co quyen xem day du (bao gom `presenceSource`, `checkInTime`, `lastDetectedAt`) cho tat ca participant trong meeting cua ho.
- Business Admin va System Admin co quyen xem day du trong toan bo he thong.
- Internal Participant (attendee thuong) chi xem duoc danh sach co ban: `fullName`, `departmentName`, `participantRole`, `presenceStatus`. Khong xem duoc `presenceSource`, `checkInTime`, `lastSeenAt` cua nguoi khac. Co the xem `presenceSource` va `checkInTime` cua chinh minh.
- Backend enforce field-level authorization - khong chi dua vao frontend de an field nhay cam.

### 2.3 Actor Constraints

- Nguoi dung phai dang nhap (JWT hop le).
- Nguoi dung phai co permission `meeting.presence.read`.
- Host phai la host cua meeting do (ownership check).
- Business Admin va System Admin co quyen xuyen suot he thong.

---

## 3. Functional Requirements

### 3.1 Core Requirements

FR-001: THE system SHALL tra ve danh sach nguoi dang co mat duoi dang read-only - khong tao, sua, xoa bat ky ban ghi nao trong attendance_records, attendance_events, presence_snapshots, meeting_participants hay meetings khi phuc vu yeu cau nay.

FR-002: THE system SHALL su dung attendance_records va presence_snapshots lam nguon du lieu hien dien chinh, ket hop voi meeting_participants de xac dinh danh sach nguoi tham gia day du.

FR-003: THE system SHALL NOT bao gom external participants trong danh sach hien dien.

FR-004: THE system SHALL tra ve occupancyCount la tong so nguoi dang co mat (presenceStatus = present hoac maybe_present).

### 3.2 Event-driven Requirements

FR-005: WHEN Host gui yeu cau GET present-attendees, THE system SHALL kiem tra authentication token hop le truoc khi xu ly bat ky logic nao khac.

FR-006: WHEN authentication thanh cong, THE system SHALL kiem tra quyen `meeting.presence.read` va ownership (Host/Admin scope) truoc khi truy xuat du lieu.

FR-007: WHEN quyen duoc xac thuc thanh cong, THE system SHALL truy xuat danh sach internal participants tu `meeting_participants` ket hop `users`, `departments`, `attendance_records`, va `presence_snapshots`.

FR-008: WHEN nguoi dung gui query param `search`, THE system SHALL tim kiem khong phan biet hoa thuong tren `full_name` hoac `email` cua participant.

FR-009: WHEN nguoi dung gui query param `departmentId`, THE system SHALL loc danh sach theo phong ban.

### 3.3 State-driven Requirements

FR-010: WHILE meeting dang o trang thai `in_progress`, THE system SHALL cho phep truy cap danh sach hien dien realtime.

FR-011: WHILE meeting dang o trang thai `scheduled` va `now` nam trong khoang `[start_time, end_time + 30 minutes]`, THE system SHALL cho phep truy cap danh sach hien dien (ho tro truong hop Host quen bam Start).

FR-012: WHILE meeting dang o trang thai `completed`, `cancelled`, hoac `scheduled` voi `now < start_time` hoac `now > end_time + 30 minutes`, THE system SHALL tu choi yeu cau voi loi `MEETING_NOT_IN_PROGRESS`.

FR-013: WHILE nguoi dung la Internal Participant (attendee thuong), THE system SHALL che giau truong `presenceSource`, `checkInTime`, `lastSeenAt` cua nguoi khac trong response.

### 3.4 Optional Feature Requirements

FR-014: WHERE WebSocket realtime duoc kich hoat, THE system SHALL ho tro client subscribe event `meeting.presence.updated` de nhan cap nhat realtime khi co nguoi vao/roi phong hoac trang thai hien dien thay doi.

FR-015: WHERE camera/IoT presence detection duoc cau hinh cho phong hop, THE system SHALL hien thi nguon `room_camera` hoac `door_checkin` trong `presenceSource` cho user co quyen.

FR-016: WHERE app WebSocket connection tracking duoc trien khai, THE system SHALL hien thi nguon `app_login` cho nguoi tham gia online.

### 3.5 Unwanted Behavior Requirements

FR-017: IF nguoi dung chua dang nhap, THEN THE system SHALL tu choi yeu cau voi status 401.

FR-018: IF nguoi dung da dang nhap nhung khong co quyen `meeting.presence.read`, THEN THE system SHALL tu choi yeu cau voi status 403 va error code PERMISSION_DENIED.

FR-019: IF meeting khong ton tai (bao gom da soft-delete), THEN THE system SHALL tu choi yeu cau voi status 404 va error code MEETING_NOT_FOUND.

FR-020: IF meeting khong o trang thai `in_progress` hoac `scheduled` voi `now >= start_time`, THEN THE system SHALL tu choi yeu cau voi status 409 va error code MEETING_NOT_IN_PROGRESS.

FR-021: IF search query vuot qua 100 ky tu, THEN THE system SHALL tu choi yeu cau voi status 400 va error code INVALID_QUERY.

FR-022: IF departmentId khong phai UUID hop le, THEN THE system SHALL tu choi yeu cau voi status 400.

FR-023: IF database query bi loi, THEN THE system SHALL tra ve status 500 va ghi log loi noi bo.

### 3.6 Authorization Requirements

FR-024: IF the user is not authenticated, THEN THE system SHALL reject access to this feature.

FR-025: IF the user does not have `meeting.presence.read` permission, THEN THE system SHALL reject the request without modifying data.

FR-026: WHEN the user performs a view present-attendees action, THE system SHALL verify authorization (Host ownership or Admin scope) before processing business logic.

FR-027: WHILE the user is acting as a regular participant, THE system SHALL restrict `presenceSource`, `checkInTime`, and `lastSeenAt` fields in the API response for other participants.

FR-028: WHILE the user is Host, Business Admin, or System Admin, THE system SHALL return full presence details including source and timestamps.

### 3.7 Data & State Requirements

FR-029: WHEN danh sach hien dien duoc truy xuat thanh cong, THE system SHALL tra ve `occupancyCount` (so nguoi dang co mat) va `updatedAt` (thoi diem du lieu duoc tong hop gan nhat).

FR-030: WHEN xac dinh `presenceStatus` cho moi participant, THE system SHALL chi su dung cac trang thai thuc te, uu tien:
  1) `presence_snapshots.presence_status = 'present'`: `present`.
  2) `attendance_records.attendance_status = 'present'` hoac `'late'`: `present`.
  3) `presence_snapshots.presence_status = 'maybe_present'`: `maybe_present`.
  4) Co attendance_record da check-in trong ngay nhung roi khoi: `left`.
  5) Khong co du lieu hien dien: `absent` hoac `unknown`. (Ghi chu: online/app presence tracking la future scope).

FR-031: WHEN xac dinh `presenceSource`, THE system SHALL uu tien: `room_camera` > `door_checkin` > `manual_host` > `not_detected`.

FR-032: THE system SHALL tra ve `joinedAt` uu tien theo: 1) `attendance_records.check_in_time`, 2) `attendance_events.event_time` (check_in/enter_room), 3) `meeting_participants.joined_at`. Neu chi co snapshot present thi de `joinedAt = null` nhung van tra ve ket qua hien dien.

FR-033: THE system SHALL tra ve `lastSeenAt` (thoi diem phat hien gan nhat) tu `presence_snapshots.snapshot_time` neu co.

### 3.8 Notification / Audit Requirements

FR-034: WHERE policy yeu cau tracking truy cap du lieu nhay cam, THE system SHALL ghi audit log dang non-blocking khi yeu cau lay danh sach thanh cong voi action_type = `read_live_participants`.

FR-035: WHEN audit log duoc ghi, THE system SHALL bao gom: `entity_type = meeting`, `entity_id = meetingId`, `metadata_json` chua `viewerUserId`, `viewerRole`, `resultCount`.

FR-036: IF ghi audit log that bai, THEN THE system SHALL chi ghi log internal (console/file) va khong tra loi cho user. Khong ghi toan bo presence list vao audit log de tranh lo du lieu nhay cam.

### 3.9 Integration / Device Requirements

FR-037: WHERE device check-in (Door Face Attendance Terminal) duoc cau hinh, THE system SHALL hien thi `presenceSource = door_checkin` cho participant da check-in qua thiet bi.

FR-038: WHERE room camera presence detection duoc kich hoat, THE system SHALL hien thi `presenceSource = room_camera` cho participant duoc phat hien trong phong.

### 3.10 Complex / Combined Requirements

FR-039: WHILE meeting dang `in_progress`, WHEN Host gui yeu cau present-attendees, THE system SHALL kiem tra quyen, truy xuat presence data tu nhieu nguon, tong hop va tra ve danh sach kem occupancyCount.

FR-040: WHILE meeting dang `in_progress`, WHEN Business Admin xem tu room monitoring, THE system SHALL xac dinh room_id tu `room_bookings` active cua meeting, sau do tra ve danh sach hien dien cho meeting do.

### 3.11 Traceability

| Requirement ID | EARS Pattern | Nguon / Use Case lien quan |
|---|---|---|
| FR-001 | Ubiquitous | UC-100, UC-IMM-07 |
| FR-002 | Ubiquitous | UC-100 |
| FR-003 | Ubiquitous | UC-100 |
| FR-004 | Ubiquitous | UC-100 |
| FR-005 | Event-driven | UC-100 |
| FR-006 | Event-driven | UC-100 |
| FR-007 | Event-driven | UC-100 |
| FR-008 | Event-driven | UC-100 |
| FR-009 | Event-driven | UC-100 |
| FR-010 | State-driven | UC-100 |
| FR-011 | State-driven | UC-100 (relaxed) |
| FR-012 | State-driven | UC-100 |
| FR-013 | State-driven | UC-100 |
| FR-014 | Optional Feature | UC-100 |
| FR-015 | Optional Feature | UC-100 |
| FR-016 | Optional Feature | UC-100 |
| FR-017-FR-023 | Unwanted Behavior | UC-100 |
| FR-024-FR-028 | Authorization | UC-100 |
| FR-029-FR-033 | Data & State | UC-100 |
| FR-034-FR-036 | Audit | UC-100 |
| FR-037-FR-038 | Integration | UC-100 |
| FR-039-FR-040 | Complex | UC-100 |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL tra ve danh sach hien dien cho meeting co 20-100 participants trong vong duoi 3 giay trong dieu kien tai binh thuong.

NFR-002: THE system SHALL ho tro toi thieu 50 yeu cau dong thoi cho endpoint present-attendees.

### 4.2 Security

NFR-003: THE system SHALL yeu cau authentication truoc khi truy cap danh sach hien dien.

NFR-004: THE system SHALL enforce authorization (permission + ownership) cho moi request.

NFR-005: THE system SHALL NOT expose `presenceSource` chi tiet cho participant thuong.

### 4.3 Reliability & Consistency

NFR-006: THE system SHALL dam bao response danh sach hien dien nhat quan trong cung mot thoi diem.

NFR-007: THE system SHALL su dung index tren `meeting_id`, `user_id`, `presence_status`, `attendance_status`.

### 4.4 Usability

NFR-008: THE system SHALL tra ve clear error messages.

NFR-009: THE system SHALL ho tro search va filter de user tim nhanh participant.

NFR-010: THE system SHALL tra ve field names dang camelCase theo convention API chung.

---

## 5. Data Model

### 5.1 Entity lien quan

| Entity / Table | Vai tro trong tinh nang | Ghi chu |
|---|---|---|
| `meetings` | Kiem tra quyen truy cap, trang thai, room_id | Chi cho phep `in_progress` hoac `scheduled & now >= start_time` |
| `meeting_participants` | Danh sach nguoi tham gia noi bo, participant_role | Chi lay internal participants |
| `users` | Thong tin ca nhan: full_name, email, avatar_url, direct_manager_id | Join de lay thong tin hien thi |
| `departments` | Thong tin phong ban: department_name | Join qua users.department_id |
| `attendance_records` | Du lieu diem danh: check_in_time, attendance_status, attendance_source | Join qua meeting_id + user_id |
| `presence_snapshots` | Du lieu hien dien realtime: presence_status, source, last_detected_at | Join qua room_id + user_id hoac meeting_id |
| `attendance_events` | Su kien check-in/check-out (optional, dung de suy luan) | Khong join truc tiep, dung de fallback |
| `rooms` | Thong tin phong: room_name, current_status | Lien quan cho AF Business Admin |
| `room_bookings` | Xac nhan booking active cho meeting | Xac dinh room_id va trang thai su dung phong |
| `room_booking_usages` | Usage thuc te: usage_status = in_use, actual_start_time | Xac nhan phong dang duoc su dung |
| `audit_logs` | Ghi audit log khi Host/Admin xem danh sach | Non-blocking write |

### 5.2 Du lieu dau vao

| Field | Type du kien | Bat buoc | Mo ta | Validation |
|---|---:|---:|---|---|
| `meetingId` | UUID (path param) | Co | ID cua cuoc hop | UUID v4 hop le, meeting ton tai, deleted_at IS NULL |
| `search` | string | Khong | Tim kiem theo full_name hoac email | Trim, max 100 ky tu |
| `departmentId` | UUID | Khong | Loc theo phong ban | UUID v4 hop le |
| `page` | integer | Khong | So trang | >= 1, default 1 |
| `limit` | integer | Khong | So ban ghi moi trang | 1-100, default 20 |
| `sortBy` | string | Khong | Truong sap xep | Allowlist: full_name, department_name, presence_status, joined_at |
| `sortOrder` | string | Khong | Thu tu sap xep | asc/desc, default asc |

### 5.3 Du lieu dau ra

| Field | Type du kien | Mo ta |
|---|---:|---|
| `occupancyCount` | integer | So nguoi dang co mat (presenceStatus = in_room/present/online/checked_in) |
| `presentUsers[].userId` | UUID | ID nguoi dung |
| `presentUsers[].fullName` | string | Ho ten participant |
| `presentUsers[].email` | string | Email participant |
| `presentUsers[].departmentId` | UUID/null | ID phong ban |
| `presentUsers[].departmentName` | string/null | Ten phong ban |
| `presentUsers[].participantRole` | string | host, attendee, approver, note_taker |
| `presentUsers[].presenceStatus` | string | present, maybe_present, left, absent, unknown |
| `presentUsers[].presenceSource` | string/null | Nguon hien dien - chi tra neu co quyen |
| `presentUsers[].confidenceScore` | number/null | Do tin cay cua data (neu tu camera) |
| `presentUsers[].checkInTime` | ISO-8601/null | Thoi gian check-in (tu attendance_records) - chi tra neu co quyen |
| `presentUsers[].joinedAt` | ISO-8601/null | Thoi diem phat hien dau tien trong session |
| `presentUsers[].lastSeenAt` | ISO-8601/null | Thoi diem phat hien gan nhat - chi tra neu co quyen |
| `presentUsers[].avatarUrl` | string/null | URL avatar |
| `updatedAt` | ISO-8601 | Thoi diem du lieu duoc tong hop gan nhat |

### 5.4 State / Status Model

**PresenceStatus values:**

| Status | Y nghia | Nguon du lieu |
|---|---|---|
| `present` | Dang co mat (trong phong) | `presence_snapshots` = present hoac `attendance_records` = present |
| `maybe_present` | Co the co mat nhung chua xac dinh ro | `presence_snapshots` = maybe_present |
| `left` | Da check-in nhung sau do roi khoi | Logic ket hop check_out_time |
| `absent` | Vang mat | Du lieu ro rang la vang |
| `unknown` | Khong co du lieu hien dien | Default khi thieu data |

### 5.5 Data Constraints

- Chi internal participants tu `meeting_participants.invitation_status` khong phai `declined`.
- Meeting status phai la `in_progress` hoac (`scheduled` va `now >= start_time`).
- Neu meeting khong co room_id, van tra danh sach participants online (neu co).
- Khong trung lap participant trong response.
- Audit log ghi non-blocking, khong anh huong response.

### 5.6 Data Lifecycle

- Du lieu presence la transient va realtime, khong co khai niem "snapshot cuoi cung" cho feature nay.
- `attendance_records` la persistent, `presence_snapshots` la transient (luon duoc cap nhat).
- `audit_logs` ghi sau khi response thanh cong, khong blocking.

### 5.7 Data-related EARS Requirements

FR-DATA-001: WHEN danh sach hien dien duoc truy xuat, THE system SHALL left join `attendance_records` tren `meeting_id` va `user_id` de lay thong tin check-in.

FR-DATA-002: WHEN danh sach hien dien duoc truy xuat, THE system SHALL left join `presence_snapshots` tren `room_id` va `user_id` (hoac `meeting_id`) de lay thong tin presence realtime.

FR-DATA-003: IF `attendance_records` va `presence_snapshots` deu khong co du lieu, THEN THE system SHALL tra ve `presenceStatus = not_detected`.

FR-DATA-004: IF co nhieu presence_snapshots cho cung user, THEN THE system SHALL lay ban ghi moi nhat theo `snapshot_time`.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `meetingId` is missing or invalid UUID format, THEN THE system SHALL reject request voi status 400.

ERR-002: IF `search` vuot qua 100 ky tu, THEN THE system SHALL reject request voi status 400 va error code INVALID_QUERY.

ERR-003: IF `departmentId` khong phai UUID hop le, THEN THE system SHALL reject request voi status 400.

ERR-004: IF `page` < 1 hoac `limit` < 1 hoac `limit` > 100, THEN THE system SHALL reject request voi status 400.

### 6.2 Authentication / Authorization Errors

ERR-005: IF nguoi dung chua dang nhap, THEN THE system SHALL return 401.

ERR-006: IF nguoi dung khong co quyen hoac khong phai Host/Admin, THEN THE system SHALL return 403 voi error code FORBIDDEN_LIVE_PARTICIPANTS_ACCESS.

### 6.3 Business Rule Errors

ERR-007: IF meeting khong ton tai hoac da soft-delete, THEN THE system SHALL return 404 voi error code MEETING_NOT_FOUND.

ERR-008: IF meeting khong o trang thai `in_progress` hoac `scheduled` voi `now >= start_time`, THEN THE system SHALL return 409 voi error code MEETING_NOT_IN_PROGRESS.

ERR-009: IF room khong co booking active (cho AF Admin), THEN THE system SHALL return 409 voi error code ROOM_NOT_IN_USE.

### 6.4 System Errors

ERR-010: IF database query that bai, THEN THE system SHALL return 500 voi error code INTERNAL_ERROR.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Host da dang nhap va meeting dang IN_PROGRESS,
When Host mo tab Participants trong In-Meeting Dashboard,
Then he thong tra ve danh sach day du internal participants kem presenceStatus, presenceSource, joinedAt, lastSeenAt, confidenceScore va occupancyCount.

AC-002:
Given Business Admin dang xem man hinh room monitoring realtime,
When Admin chon room co status in_use/occupied,
Then he thong tra ve danh sach hien dien cho meeting dang dien ra trong room do.

### 7.2 Field-level Authorization Cases

AC-003:
Given Participant thuong dang xem tab Participants,
Then participant thay danh sach co ban (fullName, departmentName, participantRole, presenceStatus),
nhung khong thay presenceSource, confidenceScore, checkInTime, lastSeenAt cua nguoi khac.

AC-004:
Given Participant thuong xem tab Participants,
When participant xem thong tin cua chinh minh,
Then participant thay presenceSource va checkInTime cua ban than.

### 7.3 Business Rule Cases

AC-005:
Given meeting dang `scheduled` va now >= start_time,
When Host mo tab Participants,
Then he thong van tra ve danh sach hien dien (ho tro truong hop quen bam Start).

AC-006:
Given meeting dang `scheduled` va now < start_time,
When Host mo tab Participants,
Then he thong tu choi voi MEETING_NOT_IN_PROGRESS.

AC-007:
Given meetingId khong ton tai hoac da soft-delete,
When gui yeu cau,
Then he thong tra 404 MEETING_NOT_FOUND.

AC-008:
Given nguoi dung khong co quyen `meeting.presence.read`,
When gui yeu cau,
Then he thong tra 403 PERMISSION_DENIED.

### 7.4 Search / Filter Cases

AC-009:
Given danh sach participants > 20,
When nguoi dung gui search=Nguyen,
Then he thong tra ve danh sach participants co full_name hoac email chua "Nguyen".

AC-010:
Given danh sach participants nhieu phong ban,
When nguoi dung gui departmentId=uuid,
Then he thong tra ve danh sach participants thuoc phong ban do.

### 7.5 Audit Cases

AC-011:
Given Host hoac Admin xem danh sach hien dien thanh cong,
When response tra ve 200,
Then he thong ghi audit_logs voi action_type = read_live_participants (non-blocking).

### 7.6 Acceptance Criteria Traceability

| AC ID | Requirement ID lien quan | Kich ban test chinh |
|---|---|---|
| AC-001 | FR-001, FR-007, FR-010 | Host xem danh sach day du |
| AC-002 | FR-007, FR-010, FR-040 | Admin xem tu room monitoring |
| AC-003 | FR-013, FR-027 | Participant thay field gioi han |
| AC-004 | FR-027 | Participant thay source cua minh |
| AC-005 | FR-011 | Meeting scheduled nhung da den gio |
| AC-006 | FR-012, ERR-008 | Meeting chua den gio |
| AC-007 | ERR-007 | Meeting khong ton tai |
| AC-008 | FR-025, ERR-006 | Thieu quyen |
| AC-009 | FR-008 | Search theo ten |
| AC-010 | FR-009 | Filter theo phong ban |
| AC-011 | FR-034, FR-035 | Audit log duoc ghi |

---

## 8. Out of Scope

Cac noi dung sau **khong thuoc pham vi** cua feature UC-IMM-07:

- Tao, sua, xoa attendance records, attendance_events, presence_snapshots.
- Check-in/check-out participants.
- Bat dau/ket thuc/gia han phien hop (UC-IMM-01, UC-IMM-02, ...).
- Xu ly no-show detection.
- Ghi am/ghi hinh/transcription.
- Gui notification/email.
- Tich hop truc tiep voi camera/IoT device de phat hien presence (viec nay thuoc module `iot`, `attendance`, `presence`).
- WebSocket realtime push implementation chi tiet (chi mo ta o muc optional).
- Manager scope nhieu cap (recursive tree).
- External participants.
- Auto-refresh co che: client tu quyet dinh polling interval, backend khong chu dong push neu khong co WebSocket.

### 8.1 Khong trien khai trong feature nay

- Khong tao/sua/xoa bat ky ban ghi nao trong attendance_records, presence_snapshots, meetings.
- Khong them bang database moi.
- Khong them migration moi.
- Khong implement WebSocket Gateway rieng cho feature nay.

### 8.2 Co the xem xet o feature khac

- WebSocket realtime push cho presence updates.
- Presence detection tu camera/IoT tu dong.
- Manager scope nhieu cap.
- Hien thi presence cua external participants.
- Auto-refresh voi delta changes (?since=timestamp).

### 8.3 Out-of-scope EARS Guardrails

OOS-001: THE system SHALL NOT tao, sua, xoa bat ky ban ghi attendance_records hoac presence_snapshots nao khi phuc vu feature nay.

OOS-002: THE system SHALL NOT implement WebSocket Gateway nhu mot phan bat buoc cua feature nay.

OOS-003: THE system SHALL NOT them bang database moi hoac migration ngoai baseline v3.2 Compact.

---

## 9. API Contract

### Endpoint: Xem danh sach nguoi dang co mat

`GET /api/v1/live-meetings/{meetingId}/present-attendees`

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/present-attendees` |
| Permission | `meeting.presence.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query Parameters:**

```
?search=Nguyen&departmentId=uuid&page=1&limit=20&sortBy=full_name&sortOrder=asc
```

**Response 200 (Host/Admin co quyen day du):**

```json
{
  "success": true,
  "message": "Danh sach nguoi tham du dang co mat",
  "data": {
    "meetingId": "uuid",
    "occupancyCount": 5,
    "presentUsers": [
      {
        "userId": "uuid",
        "fullName": "Nguyen Van A",
        "email": "nva@company.com",
        "departmentId": "uuid",
        "departmentName": "Phong IT",
        "avatarUrl": "https://...",
        "participantRole": "host",
        "presenceStatus": "present",
        "presenceSource": "room_camera",
        "confidenceScore": 0.95,
        "checkInTime": "2026-06-17T09:00:00+07:00",
        "joinedAt": "2026-06-17T09:00:00+07:00",
        "lastSeenAt": "2026-06-17T09:50:30+07:00"
      }
    ],
    "updatedAt": "2026-06-17T09:50:30+07:00"
  },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 8,
    "totalPages": 1
  }
}
```

**Response 200 (Participant thuong - field bi che):**

```json
{
  "success": true,
  "message": "Danh sach nguoi tham du dang co mat",
  "data": {
    "meetingId": "uuid",
    "occupancyCount": 5,
    "presentUsers": [
      {
        "userId": "uuid",
        "fullName": "Nguyen Van A",
        "departmentName": "Phong IT",
        "avatarUrl": "https://...",
        "participantRole": "host",
        "presenceStatus": "present",
        "presenceSource": null,
        "confidenceScore": null,
        "checkInTime": null,
        "joinedAt": null,
        "lastSeenAt": null
      }
    ],
    "updatedAt": "2026-06-17T09:50:30+07:00"
  },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 8,
    "totalPages": 1
  }
}
```

**Luu y:** `presenceSource`, `confidenceScore`, `checkInTime`, `joinedAt`, `lastSeenAt` tra ve `null` cho participant thuong khi xem nguoi khac. Khi participant xem chinh minh, cac field nay tra gia tri that.

**Error Codes:**

| HTTP Status | Error Code | Mo ta |
|---:|---|---|
| 400 | INVALID_QUERY | Search > 100 ky tu hoac page/limit khong hop le |
| 401 | UNAUTHORIZED | Chua dang nhap hoac token het han |
| 403 | FORBIDDEN_LIVE_PARTICIPANTS_ACCESS | Khong co quyen (khong phai Host/Admin) |
| 404 | MEETING_NOT_FOUND | Meeting khong ton tai hoac da soft-delete |
| 409 | MEETING_NOT_IN_PROGRESS | Meeting chua dien ra hoac da ket thuc |
| 500 | INTERNAL_ERROR | Loi server |
