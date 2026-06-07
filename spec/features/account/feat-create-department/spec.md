> FILE: spec/features/account/feat-create-department/spec.md
> NGÀY TẠO: 2026-06-08
> NGUỒN: UC-AM-03 Khởi tạo phòng ban mới (SRS), UC-07 API Contract v1.0, Database v3.2 Compact (bảng departments)

## CHANGELOG
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-08 | Tạo mới spec từ SRS UC-AM-03 + API Contract UC-07 + Database v3.2 Compact | Toàn bộ file |
| 2026-06-08 | Áp dụng clarify decisions + idempotency + fix ERR-009 duplicate + XSS sanitization + requestId format | Clarifications, FR-026/027, NFR-005/012, §6.3→6.5, §5.2

# Feature Specification: Khởi tạo phòng ban mới

- **Feature ID**: ORG-DEPT-CREATE-001
- **Feature Name**: Khởi tạo phòng ban mới
- **Module / Domain**: accounts (Account Management)
- **Created Date**: 2026-06-08
- **Status**: Draft — Clarified
- **Source Documents**:
  - UC-AM-03 Khởi tạo phòng ban mới (SRS)
  - UC-07 API Contract v1.0 — Account Management
  - Database v3.2 Compact (bảng departments)
  - Clarification decisions 2026-06-08 (8 questions)

---

## Clarifications

### Session 2026-06-08

- Q: Format ràng buộc của departmentCode? → A: Trim → uppercase, pattern ^[A-Z0-9][A-Z0-9_-]{1,49}$, 2–50 chars, unique among non-deleted. No Vietnamese accents, spaces, emoji, special symbols other than _ and -.
- Q: Format ràng buộc của departmentName? → A: Trim, 2–150 chars, allow Vietnamese chars + English + numbers + spaces + common separators (&, -, _, ., /, (, ), ,). No emoji, control chars, unsafe script/html. Unique among non-deleted.
- Q: Xử lý empty string / whitespace-only? → A: Treated as missing for required fields. Optional description → null khi empty/whitespace-only.
- Q: Circular reference + depth limit cho hierarchy? → A: Phải prevent circular reference. Max depth 5 levels.
- Q: Dropdown display order? → A: departmentName ascending → departmentCode ascending. No manual displayOrder field.
- Q: Role mapping cho department.create? → A: Assigned to ADMIN and MANAGER roles (hoặc BUSINESS_ADMIN nếu tách role sau).
- Q: Response fields khi tạo? → A: Gồm id, departmentCode, departmentName, parentDepartmentId, managerUserId, description, isActive, createdAt, updatedAt.
- Q: Race condition duplicate handling? → A: App check trước + DB unique constraint. Constraint violation → 409 DEPARTMENT_ALREADY_EXISTS.

---

## 1. Context & Goal

### 1.1 Bối cảnh

Hệ thống quản lý vòng đời cuộc họp cần có cơ cấu tổ chức (phòng ban) để phân bổ nhân sự, phân quyền, lọc báo cáo và routing phê duyệt. Phòng ban là đơn vị cơ bản để gán tài khoản người dùng (users.department_id), lọc danh sách cuộc họp, thống kê sử dụng phòng và kiểm soát truy cập dữ liệu.

Tính năng này thuộc **module ccounts** (Account Management), cho phép Business Admin khởi tạo một đơn vị, bộ phận hoặc nhóm làm việc mới vào cơ cấu tổ chức trên hệ thống.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép **Business Admin** khởi tạo một phòng ban mới với các thông tin: mã phòng ban, tên phòng ban, phòng ban cha (nếu có), người quản lý và mô tả nhằm xây dựng cơ cấu tổ chức phục vụ phân bổ nhân sự và phân quyền.

### 1.3 Giá trị mang lại

- Cho phép admin thiết lập cơ cấu tổ chức nhanh chóng, không cần can thiệp database.
- Phòng ban mới xuất hiện ngay trong dropdown chọn phòng ban khi tạo/cập nhật tài khoản người dùng (mặc định sắp xếp theo tên → mã).
- Đảm bảo tính duy nhất của mã và tên phòng ban, tránh nhầm lẫn trong vận hành.
- Hỗ trợ cấu trúc phân cấp (parent department) khi tổ chức có nhiều cấp, tối đa 5 cấp.

### 1.4 Giả định

- Người dùng đã đăng nhập và có quyền department.create.
- Dữ liệu phòng ban cha (nếu chọn) đã tồn tại, active và không bị xóa mềm trong hệ thống.
- Người quản lý (nếu chọn) đã tồn tại, active và không bị xóa mềm trong hệ thống.
- Tính năng này chỉ tạo mới, không bao gồm cập nhật, xóa, vô hiệu hóa phòng ban.
- Cây phân cấp phòng ban không vượt quá 5 cấp độ.

### 1.5 Cần làm rõ

(Không có — đã clarify toàn bộ.)

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Business Admin | Người khởi tạo phòng ban mới | Có quyền department.create; nhập thông tin phòng ban; chịu trách nhiệm tính chính xác của dữ liệu cơ cấu tổ chức |
| Hệ thống (System) | Xử lý nghiệp vụ tạo phòng ban | Kiểm tra dữ liệu đầu vào, kiểm tra unique, ghi nhận phòng ban, trả kết quả |

### 2.2 Role & Permission Rules

- Quyền department.create được gán cho role **ADMIN** và **MANAGER** (hoặc **BUSINESS_ADMIN** nếu project tách role này sau này).
- Business Admin phải có quyền department.create để sử dụng tính năng này.
- Người dùng không có quyền department.create không được phép truy cập endpoint tạo phòng ban.
- Quyền department.create thuộc module ccounts — do hệ thống RBAC cấp.

### 2.3 Actor Constraints

- Business Admin đã đăng nhập (authenticated).
- Business Admin có quyền department.create (authorized).

---

## 3. Functional Requirements

Hướng dẫn EARS: Giữ keyword EARS bằng tiếng Anh (THE system SHALL, WHEN, WHILE, WHERE, IF, THEN), nội dung nghiệp vụ bằng tiếng Việt.

### 3.1 Core Requirements (Ubiquitous)

FR-001: THE system SHALL lưu đầy đủ các trường bắt buộc khi tạo phòng ban mới: department_code, department_name, và trạng thái is_active = true.

FR-002: THE system SHALL tự động gán created_by là ID của Business Admin đang thực hiện thao tác và created_at là thời điểm hiện tại.

FR-003: THE system SHALL trim và normalize department_code sang chữ in hoa (uppercase) trước khi validation và lưu trữ, và chỉ chấp nhận department_code thỏa mãn: độ dài 2–50 ký tự, unique trên các bản ghi chưa bị xóa mềm, khớp pattern ^[A-Z0-9][A-Z0-9_-]{1,49}$. Không chấp nhận ký tự có dấu tiếng Việt, khoảng trắng, emoji hoặc ký tự đặc biệt ngoài _ và -.

FR-004: THE system SHALL trim department_name trước khi validation và lưu trữ, và department_name SHALL có độ dài 2–150 ký tự, unique trên các bản ghi chưa bị xóa mềm. department_name MAY chứa chữ tiếng Việt có dấu, chữ Anh, số, khoảng trắng và các ký tự phân cách thông dụng: &, -, _, ., /, (, ), ,. department_name SHALL NOT chứa emoji, ký tự điều khiển, hoặc nội dung script/html không an toàn. THE system SHALL strip hoặc escape HTML/script tags khỏi department_name và description trước khi persist.

### 3.2 Event-driven Requirements

FR-005: WHEN Business Admin gửi yêu cầu tạo phòng ban với dữ liệu hợp lệ, THE system SHALL tạo bản ghi phòng ban mới trong bảng departments với trạng thái is_active = true.

FR-006: WHEN Business Admin gửi yêu cầu tạo phòng ban kèm parent_department_id, THE system SHALL kiểm tra phòng ban cha tồn tại, đang active, không bị xóa mềm, SHOULD kiểm tra không tạo circular reference (phòng ban trỏ về chính nó hoặc vòng lặp qua các cấp), và SHOULD kiểm tra tổng độ sâu hierarchy không vượt quá 5 cấp trước khi tạo.

FR-007: WHEN Business Admin gửi yêu cầu tạo phòng ban kèm manager_user_id, THE system SHALL kiểm tra người quản lý có tồn tại, active và không bị xóa mềm trước khi tạo.

FR-008: WHEN phòng ban mới được tạo thành công, THE system SHALL trả về thông tin phòng ban bao gồm: id, departmentCode, departmentName, parentDepartmentId, managerUserId, description, isActive, createdAt, updatedAt.

### 3.3 State-driven Requirements

FR-009: WHILE phòng ban cha (parent_department_id) được chỉ định trong yêu cầu, THE system SHALL chỉ chấp nhận phòng ban cha đang có is_active = true và deleted_at IS NULL.

FR-010: WHILE người quản lý (manager_user_id) được chỉ định trong yêu cầu, THE system SHALL chỉ chấp nhận người dùng đang có ccount_status = 'active' và deleted_at IS NULL.

### 3.4 Optional Feature Requirements

(Không có — tính năng này không phụ thuộc feature flag hay capability tùy chọn.)

### 3.5 Unwanted Behavior Requirements

FR-011: IF department_code đã tồn tại trong hệ thống (kiểm tra trên các bản ghi chưa bị xóa mềm), THEN THE system SHALL từ chối yêu cầu và trả về lỗi 409 với mã lỗi DEPARTMENT_ALREADY_EXISTS và thông báo "Mã phòng ban này đã được sử dụng."

FR-012: IF department_name đã tồn tại trong hệ thống (kiểm tra trên các bản ghi chưa bị xóa mềm), THEN THE system SHALL từ chối yêu cầu và trả về lỗi 409 với mã lỗi DEPARTMENT_ALREADY_EXISTS và thông báo "Tên phòng ban này đã được sử dụng."

FR-013: IF department_code không được gửi, hoặc là empty string, hoặc chỉ chứa whitespace, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 400 với mã lỗi VALIDATION_ERROR và thông báo "Mã phòng ban là bắt buộc."

FR-014: IF department_name không được gửi, hoặc là empty string, hoặc chỉ chứa whitespace, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 400 với mã lỗi VALIDATION_ERROR và thông báo "Tên phòng ban là bắt buộc."

FR-015: IF department_code không thỏa mãn pattern ^[A-Z0-9][A-Z0-9_-]{1,49}$ hoặc độ dài ngoài phạm vi 2–50 ký tự, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 422 với mã lỗi VALIDATION_ERROR.

FR-016: IF department_name vượt quá độ dài 150 ký tự hoặc nhỏ hơn 2 ký tự, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 422 với mã lỗi VALIDATION_ERROR.

FR-017: IF parent_department_id được gửi nhưng không tồn tại, không active, hoặc đã bị xóa mềm, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 404 với mã lỗi RESOURCE_NOT_FOUND và thông báo "Phòng ban cha không tồn tại hoặc không hoạt động."

FR-018: IF manager_user_id được gửi nhưng không tồn tại, không active, hoặc đã bị xóa mềm, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 404 với mã lỗi RESOURCE_NOT_FOUND và thông báo "Người quản lý không tồn tại hoặc không hoạt động."

FR-CLR-001: IF parent_department_id tạo circular reference (phòng ban trỏ về chính nó hoặc tạo vòng lặp trong cây hierarchy), THEN THE system SHALL từ chối yêu cầu và trả về lỗi 422 với mã lỗi VALIDATION_ERROR và thông báo "Phòng ban cha tạo vòng lặp không hợp lệ."

FR-CLR-002: IF parent_department_id làm tổng độ sâu hierarchy vượt quá 5 cấp, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 422 với mã lỗi VALIDATION_ERROR và thông báo "Cây phân cấp phòng ban không được vượt quá 5 cấp."

FR-CLR-003: IF departmentCode hoặc departmentName chứa emoji, ký tự điều khiển, hoặc nội dung script/html không an toàn, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 422 với mã lỗi VALIDATION_ERROR.

### 3.6 Authorization Requirements

FR-019: IF người dùng chưa xác thực (unauthenticated), THEN THE system SHALL từ chối truy cập endpoint tạo phòng ban.

FR-020: IF người dùng đã xác thực nhưng không có quyền department.create (role ADMIN hoặc MANAGER), THEN THE system SHALL từ chối yêu cầu và không tạo bản ghi phòng ban.

### 3.7 Data & State Requirements

FR-021: THE system SHALL sử dụng UUID làm khóa chính cho bản ghi phòng ban mới.

FR-022: THE system SHALL thiết lập is_active = true cho phòng ban mới tạo.

FR-023: THE system SHALL ghi nhận created_at và updated_at với thời gian hiện tại (có timezone) khi tạo phòng ban.

FR-024: IF phòng ban được tạo và dữ liệu liên quan (phòng ban cha, người quản lý) không hợp lệ, THEN THE system SHALL rollback toàn bộ thao tác, không tạo bản ghi phòng ban.

FR-CLR-004: THE system SHALL kiểm tra duplicate department_code và department_name trước khi insert (application-level), đồng thời database SHALL enforce unique constraints để ngăn duplicate dưới concurrent requests. Mọi unique constraint violation từ database SHALL được map thành 409 với mã lỗi DEPARTMENT_ALREADY_EXISTS.

FR-CLR-005: THE system SHALL chuyển optional field description thành 
ull nếu giá trị là empty string hoặc whitespace-only.

### 3.8 Audit Requirements

FR-026: IF Idempotency-Key header được gửi kèm với request và key này đã được xử lý thành công trước đó với cùng payload cho cùng authenticated user, THEN THE system SHALL trả về response 201 của request gốc từ cache/storage mà không tạo department mới.

FR-027: IF Idempotency-Key header được gửi kèm với request nhưng key này đã được dùng với payload khác, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 409 với mã lỗi IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD.

FR-025: WHEN phòng ban mới được tạo thành công, THE system SHALL ghi nhận audit log với ction_type = 'create', entity_type = 'department', entity_id là ID phòng ban mới, user_id là ID của Business Admin thực hiện.

### 3.9 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-AM-03, UC-07 | Lưu đầy đủ field bắt buộc |
| FR-002 | Ubiquitous | UC-AM-03 | Gán created_by tự động |
| FR-003 | Ubiquitous | UC-AM-03 BR1, CLARIFY-Q1 | Dept code: trim, uppercase, regex, 2–50, unique non-deleted |
| FR-004 | Ubiquitous | UC-AM-03 BR2, CLARIFY-Q2 | Dept name: trim, 2–150, unique non-deleted, safe charset |
| FR-005 | Event-driven | UC-AM-03 NF step 6 | Tạo bản ghi khi dữ liệu hợp lệ |
| FR-006 | Event-driven | UC-AM-03, CLARIFY-Q4 | Check parent: tồn tại + active + non-deleted + circular ref + depth ≤ 5 |
| FR-007 | Event-driven | UC-AM-03 | Kiểm tra manager tồn tại, active, non-deleted |
| FR-008 | Event-driven | UC-AM-03 NF step 7, CLARIFY-Q7 | Trả 9 fields sau tạo |
| FR-009 | State-driven | UC-AM-03 | Parent dept phải active và non-deleted |
| FR-010 | State-driven | UC-AM-03 | Manager phải active và non-deleted |
| FR-011 | Unwanted Behavior | UC-AM-03 EX2, CLARIFY-Q1/8 | Trùng code → 409 DEPARTMENT_ALREADY_EXISTS |
| FR-012 | Unwanted Behavior | UC-AM-03 EX2, CLARIFY-Q2/8 | Trùng name → 409 DEPARTMENT_ALREADY_EXISTS |
| FR-013 | Unwanted Behavior | UC-AM-03 EX1, CLARIFY-Q3 | Thiếu/empty/whitespace code → 400 |
| FR-014 | Unwanted Behavior | UC-AM-03 EX1, CLARIFY-Q3 | Thiếu/empty/whitespace name → 400 |
| FR-015 | Unwanted Behavior | UC-AM-03, CLARIFY-Q1 | Code sai format/regex → 422 |
| FR-016 | Unwanted Behavior | UC-AM-03, CLARIFY-Q2 | Name < 2 hoặc > 150 → 422 |
| FR-017 | Unwanted Behavior | UC-AM-03 | Parent dept không hợp lệ → 404 |
| FR-018 | Unwanted Behavior | UC-AM-03 | Manager không hợp lệ → 404 |
| FR-CLR-001 | Unwanted Behavior | CLARIFY-Q4 | Circular ref → 422 |
| FR-CLR-002 | Unwanted Behavior | CLARIFY-Q4 | Depth > 5 → 422 |
| FR-CLR-003 | Unwanted Behavior | CLARIFY-Q1/2 | Emoji/control/unsafe content → 422 |
| FR-019 | Unwanted Behavior | UC-AM-03 PRE-1 | Chưa xác thực → 401 |
| FR-020 | Unwanted Behavior | UC-07 permission, CLARIFY-Q6 | Thiếu quyền → 403, role ADMIN/MANAGER được gán |
| FR-021 | Ubiquitous | DB v3.2 Compact | UUID primary key |
| FR-022 | Ubiquitous | UC-AM-03 | is_active = true |
| FR-023 | Ubiquitous | DB v3.2 Compact | created_at, updated_at |
| FR-024 | Unwanted Behavior | UC-AM-03 | Rollback khi lỗi |
| FR-CLR-004 | Ubiquitous | CLARIFY-Q8 | App check + DB unique constraint, race condition |
| FR-CLR-005 | Ubiquitous | CLARIFY-Q3 | Description empty → null |
| FR-025 | Event-driven | API Contract Phụ lục E | Audit log |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL phản hồi yêu cầu tạo phòng ban trong vòng 2 giây trong điều kiện tải bình thường.

### 4.2 Security

NFR-002: THE system SHALL yêu cầu xác thực (JWT) trước khi cho phép truy cập endpoint tạo phòng ban.

NFR-003: THE system SHALL kiểm tra quyền department.create cho mọi yêu cầu tạo phòng ban.

NFR-004: THE system SHALL KHÔNG trả về thông tin nhạy cảm (password hash, token) trong response tạo phòng ban.

NFR-005: THE system SHALL sanitize department_name và description để ngăn chặn XSS và unsafe script/html injection.

### 4.3 Reliability & Consistency

NFR-006: THE system SHALL đảm bảo tính toàn vẹn dữ liệu khi kiểm tra unique constraint: nếu department_code hoặc department_name đã tồn tại, không tạo bản ghi mới.

NFR-007: IF database transaction thất bại trong quá trình tạo phòng ban, THEN THE system SHALL rollback thao tác và trả về lỗi server.

### 4.4 Usability

NFR-008: THE system SHALL trả về thông báo lỗi bằng tiếng Việt rõ ràng cho người dùng khi validation hoặc business rule thất bại.

NFR-009: THE system SHALL sử dụng format response thống nhất theo API Contract v1.0: { success, message, data, meta }.

### 4.5 Observability

NFR-010: THE system SHALL ghi log các lỗi xử lý nghiệp vụ khi tạo phòng ban.

NFR-011: THE system SHALL ghi audit log cho hành động tạo phòng ban thành công.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| departments | Lưu thông tin phòng ban mới | Bảng chính, 39 bảng v3.2 Compact |
| users | Kiểm tra người quản lý (manager) tồn tại và active | FK manager_user_id |
| udit_logs | Ghi nhận log tạo phòng ban | ction_type = 'create', entity_type = 'department' |

### 5.2 Dữ liệu đầu vào (Request Body)

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| departmentCode | string | Có | Mã phòng ban, unique | Trim → uppercase, pattern ^[A-Z0-9][A-Z0-9_-]{1,49}$, 2–50 chars, unique non-deleted |
| departmentName | string | Có | Tên phòng ban hiển thị | Trim, 2–150 chars, unique non-deleted, safe charset (no emoji/control) |
| parentDepartmentId | uuid | Không | ID phòng ban cha | Phải tồn tại, active, non-deleted; no circular ref; depth ≤ 5 |
| managerUserId | uuid | Không | ID người quản lý | Phải tồn tại, active, non-deleted |
| description | string | Không | Mô tả nghiệp vụ | Empty/whitespace → null |

### 5.3 Dữ liệu đầu ra (Response Data)

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| id | uuid | ID phòng ban mới tạo |
| departmentCode | string | Mã phòng ban (uppercase, đã normalize) |
| departmentName | string | Tên phòng ban (đã trim) |
| parentDepartmentId | uuid | ID phòng ban cha (nếu có) |
| managerUserId | uuid | ID người quản lý (nếu có) |
| description | string | Mô tả phòng ban (null nếu trống) |
| isActive | boolean | Trạng thái active (luôn true) |
| createdAt | ISO-8601 timestamptz | Thời điểm tạo |
| updatedAt | ISO-8601 timestamptz | Thời điểm cập nhật (bằng created_at lúc tạo) |

### 5.4 State / Status Model

Phòng ban không có state machine phức tạp. Trạng thái duy nhất là is_active (boolean). Khi tạo mới, is_active luôn là 	rue.

### 5.5 Data Constraints

- department_code: UNIQUE (non-deleted), case-insensitive sau uppercase normalize, 2–50 chars, pattern ^[A-Z0-9][A-Z0-9_-]{1,49}$.
- department_name: UNIQUE (non-deleted), case-insensitive, 2–150 chars, safe charset (không emoji/control/unsafe content).
- parent_department_id: FK → departments.id, phải tồn tại, is_active = true, deleted_at IS NULL. No circular reference. Depth ≤ 5 levels.
- manager_user_id: FK → users.id, phải tồn tại, ccount_status = 'active', deleted_at IS NULL.
- Phòng ban mới luôn có is_active = true khi tạo.
- Database có unique constraint trên department_code (với WHERE deleted_at IS NULL) và department_name (với WHERE deleted_at IS NULL).
- Race condition: application-level check + DB unique constraint. Constraint violation → 409 DEPARTMENT_ALREADY_EXISTS.

### 5.6 Data Lifecycle

- Dữ liệu phòng ban được tạo khi Business Admin gửi yêu cầu hợp lệ.
- Dữ liệu phòng ban được dùng cho: gán tài khoản người dùng (users.department_id), lọc báo cáo, phân quyền.
- Dữ liệu phòng ban bị xóa mềm (deleted_at) khi admin vô hiệu hóa (không thuộc phạm vi feature này).

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF departmentCode is missing, empty, or whitespace-only, THEN THE system SHALL trả về lỗi 400 với mã lỗi VALIDATION_ERROR.

ERR-002: IF departmentName is missing, empty, or whitespace-only, THEN THE system SHALL trả về lỗi 400 với mã lỗi VALIDATION_ERROR.

ERR-003: IF departmentCode fails pattern ^[A-Z0-9][A-Z0-9_-]{1,49}$ or length 2–50, THEN THE system SHALL trả về lỗi 422 với mã lỗi VALIDATION_ERROR.

ERR-004: IF departmentName length is < 2 or > 150, THEN THE system SHALL trả về lỗi 422 với mã lỗi VALIDATION_ERROR.

ERR-011: IF parentDepartmentId creates a circular reference, THEN THE system SHALL trả về lỗi 422 với mã lỗi VALIDATION_ERROR.

ERR-012: IF parentDepartmentId exceeds max hierarchy depth of 5 levels, THEN THE system SHALL trả về lỗi 422 với mã lỗi VALIDATION_ERROR.

ERR-013: IF departmentCode or departmentName contains emoji, control characters, or unsafe content, THEN THE system SHALL trả về lỗi 422 với mã lỗi VALIDATION_ERROR.

### 6.2 Authentication / Authorization Errors

ERR-005: IF the user is not authenticated, THEN THE system SHALL trả về lỗi 401.

ERR-006: IF the user does not have permission department.create, THEN THE system SHALL trả về lỗi 403 với mã lỗi PERMISSION_DENIED.

### 6.3 Business Rule Errors

ERR-007: IF departmentCode already exists among non-deleted departments, THEN THE system SHALL trả về lỗi 409 với mã lỗi DEPARTMENT_ALREADY_EXISTS và message "Mã phòng ban này đã được sử dụng."

ERR-008: IF departmentName already exists among non-deleted departments, THEN THE system SHALL trả về lỗi 409 với mã lỗi DEPARTMENT_ALREADY_EXISTS và message "Tên phòng ban này đã được sử dụng."

ERR-014: IF a database unique constraint violation occurs (race condition), THEN THE system SHALL map to 409 với mã lỗi DEPARTMENT_ALREADY_EXISTS.

### 6.4 Conflict / Reference Errors

ERR-009: IF parentDepartmentId references a department that is not found, inactive, or deleted, THEN THE system SHALL trả về lỗi 404 với mã lỗi RESOURCE_NOT_FOUND.

ERR-010: IF managerUserId references a user that is not found, inactive, or deleted, THEN THE system SHALL trả về lỗi 404 với mã lỗi RESOURCE_NOT_FOUND.

### 6.5 Error Response Mapping

| HTTP Status | Error Code | Khi nào xảy ra |
|---:|---|---|
| 400 | VALIDATION_ERROR | Thiếu/empty/whitespace field bắt buộc |
| 401 | UNAUTHORIZED | Chưa đăng nhập hoặc token hết hạn |
| 403 | PERMISSION_DENIED | Không có quyền department.create |
| 404 | RESOURCE_NOT_FOUND | Parent dept hoặc manager không tồn tại/active |
| 409 | DEPARTMENT_ALREADY_EXISTS | Dept code/name đã tồn tại (app check hoặc DB constraint) |
| 409 | IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD | Cùng Idempotency-Key nhưng payload khác |
| 422 | VALIDATION_ERROR | Format sai, regex fail, circular ref, depth > 5, emoji/control chars |
| 500 | INTERNAL_ERROR | Lỗi server không xác định |

Error response format mặc định bao gồm: success, error (code, message, details), requestId, timestamp, path.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001: Tạo phòng ban thành công với đầy đủ thông tin
Given Business Admin có quyền department.create,
When Admin gửi yêu cầu tạo phòng ban với departmentCode = "IT", departmentName = "Phòng Công nghệ thông tin", description = "Mô tả phòng ban",
Then hệ thống tạo phòng ban thành công, trả về 201 với id, departmentCode = "IT", departmentName, managerUserId = null, description = "Mô tả phòng ban", isActive = true, createdAt và updatedAt.

AC-002: Tạo phòng ban con có phòng ban cha
Given Business Admin có quyền, phòng ban cha ID "parent-uuid" tồn tại, active, non-deleted, và depth còn ≤ 4,
When Admin gửi yêu cầu với departmentCode = "DEV", departmentName = "Phòng Phát triển", parentDepartmentId = "parent-uuid",
Then hệ thống tạo phòng ban thành công, trả về 201 với parentDepartmentId = "parent-uuid".

AC-003: Tạo phòng ban có người quản lý
Given Business Admin có quyền, user ID "manager-uuid" tồn tại, active, non-deleted,
When Admin gửi yêu cầu với departmentCode = "HR", departmentName = "Phòng Nhân sự", managerUserId = "manager-uuid",
Then hệ thống tạo phòng ban thành công, trả về 201 với managerUserId = "manager-uuid".

### 7.2 Validation Cases

AC-004: Thiếu departmentCode
Given Business Admin có quyền,
When Admin gửi yêu cầu không có departmentCode (hoặc empty string, hoặc whitespace-only),
Then hệ thống trả về 400 với mã lỗi VALIDATION_ERROR.

AC-005: Thiếu departmentName
Given Business Admin có quyền,
When Admin gửi yêu cầu không có departmentName (hoặc empty string, hoặc whitespace-only),
Then hệ thống trả về 400 với mã lỗi VALIDATION_ERROR.

AC-006: DepartmentCode không đúng format
Given Business Admin có quyền,
When Admin gửi yêu cầu với departmentCode chứa ký tự đặc biệt không hợp lệ (vd: "IT DEPT", "it@dept", "abc™"),
Then hệ thống trả về 422 với mã lỗi VALIDATION_ERROR.

AC-007: DepartmentCode quá ngắn
Given Business Admin có quyền,
When Admin gửi yêu cầu với departmentCode chỉ 1 ký tự,
Then hệ thống trả về 422 với mã lỗi VALIDATION_ERROR.

AC-008: DepartmentCode quá dài
Given Business Admin có quyền,
When Admin gửi yêu cầu với departmentCode dài hơn 50 ký tự,
Then hệ thống trả về 422 với mã lỗi VALIDATION_ERROR.

AC-009: DepartmentName quá dài
Given Business Admin có quyền,
When Admin gửi yêu cầu với departmentName dài hơn 150 ký tự,
Then hệ thống trả về 422 với mã lỗi VALIDATION_ERROR.

AC-010: DepartmentName quá ngắn
Given Business Admin có quyền,
When Admin gửi yêu cầu với departmentName chỉ 1 ký tự,
Then hệ thống trả về 422 với mã lỗi VALIDATION_ERROR.

AC-011: Emoji trong departmentName
Given Business Admin có quyền,
When Admin gửi yêu cầu với departmentName chứa emoji,
Then hệ thống trả về 422 với mã lỗi VALIDATION_ERROR.

### 7.3 Authorization Cases

AC-012: Người dùng chưa đăng nhập
Given người dùng chưa xác thực,
When gửi yêu cầu tạo phòng ban,
Then hệ thống trả về 401.

AC-013: Người dùng không có quyền department.create
Given người dùng đã đăng nhập nhưng không có quyền department.create (không phải ADMIN/MANAGER),
When gửi yêu cầu tạo phòng ban,
Then hệ thống trả về 403 với mã lỗi PERMISSION_DENIED và không tạo bản ghi.

### 7.4 Business Rule Cases

AC-014: DepartmentCode đã tồn tại
Given departmentCode = "IT" đã tồn tại trong hệ thống (non-deleted),
When Admin gửi yêu cầu tạo phòng ban với departmentCode = "IT",
Then hệ thống trả về 409 với mã lỗi DEPARTMENT_ALREADY_EXISTS.

AC-015: DepartmentName đã tồn tại
Given departmentName = "Phòng Công nghệ thông tin" đã tồn tại (non-deleted),
When Admin gửi yêu cầu với departmentName trùng,
Then hệ thống trả về 409 với mã lỗi DEPARTMENT_ALREADY_EXISTS.

AC-016: Race condition — hai request tạo cùng departmentCode đồng thời
Given hai concurrent request cùng gửi với departmentCode = "NEW",
When cả hai request được xử lý,
Then một request thành công (201), request còn lại thất bại (409 DEPARTMENT_ALREADY_EXISTS).

### 7.5 Hierarchy Validation Cases

AC-017: ParentDepartmentId không tồn tại
Given phòng ban cha ID không tồn tại, không active, hoặc đã bị soft delete,
When Admin gửi yêu cầu với parentDepartmentId đó,
Then hệ thống trả về 404 với mã lỗi RESOURCE_NOT_FOUND.

AC-018: Circular reference
Given phòng ban mới có ID sẽ là "new-id", và parentDepartmentId trỏ về chính "new-id" hoặc tạo vòng lặp,
When Admin gửi yêu cầu,
Then hệ thống trả về 422 với mã lỗi VALIDATION_ERROR.

AC-019: Hierarchy vượt quá 5 cấp
Given phòng ban cha ở cấp độ 5,
When Admin gửi yêu cầu với parentDepartmentId đó,
Then hệ thống trả về 422 với mã lỗi VALIDATION_ERROR.

### 7.6 Audit Cases

AC-020: Audit log được ghi khi tạo thành công
Given yêu cầu tạo phòng ban hợp lệ,
When hệ thống tạo phòng ban thành công,
Then hệ thống ghi audit log với ction_type = 'create', entity_type = 'department', entity_id là ID phòng ban mới, user_id là ID của Business Admin.

### 7.7 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-002, FR-005, FR-008, FR-021, FR-022, FR-023 | Happy path |
| AC-002 | FR-006, FR-009 | Tạo phòng ban con |
| AC-003 | FR-007, FR-010 | Tạo phòng ban có manager |
| AC-004 | FR-013, ERR-001 | Thiếu/empty/whitespace code |
| AC-005 | FR-014, ERR-002 | Thiếu/empty/whitespace name |
| AC-006 | FR-003, FR-015, ERR-003 | Code sai format |
| AC-007 | FR-003, FR-015, ERR-003 | Code quá ngắn (< 2) |
| AC-008 | FR-015, ERR-003 | Code quá dài (> 50) |
| AC-009 | FR-016, ERR-004 | Name quá dài (> 150) |
| AC-010 | FR-004, FR-016, ERR-004 | Name quá ngắn (< 2) |
| AC-011 | FR-CLR-003, ERR-013 | Emoji trong name |
| AC-012 | FR-019, ERR-005 | Chưa xác thực |
| AC-013 | FR-020, ERR-006 | Không có quyền |
| AC-014 | FR-011, ERR-007 | Trùng code |
| AC-015 | FR-012, ERR-008 | Trùng name |
| AC-016 | FR-CLR-004, ERR-014 | Race condition |
| AC-017 | FR-017, ERR-009 | Parent không hợp lệ |
| AC-018 | FR-CLR-001, ERR-011 | Circular ref |
| AC-019 | FR-CLR-002, ERR-012 | Depth > 5 |
| AC-020 | FR-025 | Audit log |

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

- Cập nhật thông tin phòng ban (sửa tên, mã, quản lý).
- Vô hiệu hóa / xóa phòng ban (soft delete hoặc deactivate).
- Xem danh sách / chi tiết phòng ban (endpoint GET).
- Import phòng ban từ file Excel.
- Phân quyền theo phòng ban (scoping data by department).
- Báo cáo / thống kê theo phòng ban.
- Tích hợp với hệ thống Active Directory / LDAP.
- Field displayOrder — không cần trong use case này.

### 8.1 Không triển khai trong feature này

- Không implement endpoint GET, PATCH, DELETE cho departments.
- Không implement import bulk departments.
- Không implement department hierarchy tree visualization logic.

### 8.2 Có thể xem xét ở feature khác

- Cập nhật / vô hiệu hóa phòng ban (feat-update-department).
- Danh sách / chi tiết phòng ban (feat-list-department).
- Import phòng ban từ Excel.

### 8.3 Out-of-scope EARS Guardrails

OOS-001: THE system SHALL NOT implement update, delete, or deactivate department logic as part of this feature.

OOS-002: THE system SHALL NOT create new database tables or fields beyond what is defined in Database v3.2 Compact for this feature.

OOS-003: THE system SHALL NOT generate notifications or send emails when a department is created.

OOS-004: THE system SHALL NOT implement department-level data scoping or RBAC filtering logic in this feature.

---

## Checklist tự kiểm tra

- [x] Spec đã có đủ 8 thành phần chính + Clarifications section.
- [x] Functional Requirements đã viết theo EARS.
- [x] Requirement sử dụng keyword EARS bằng tiếng Anh.
- [x] Đã có đủ 5 EARS basic patterns.
- [x] Mỗi requirement có mã ID rõ ràng.
- [x] Requirement có thể kiểm thử được.
- [x] Không mô tả quá sâu implementation.
- [x] Không tự ý thêm feature ngoài tài liệu nguồn.
- [x] Không tự ý thêm database table/field mới.
- [x] Error handling đã bao gồm validation, auth, authorization, business rule, conflict, circular ref, depth limit, race condition.
- [x] Acceptance Criteria dùng Given / When / Then.
- [x] Traceability đã liên kết AC với FR/ERR/NFR.
- [x] Out of Scope đủ rõ để tránh agent tự mở rộng.
- [x] Tất cả clarify decisions đã được integrate vào spec.


