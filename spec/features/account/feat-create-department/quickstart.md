# Quickstart: Khởi tạo phòng ban mới (UC-AM-03)

**Prerequisites**: Node.js + PostgreSQL running + JWT token with department.create permission.

---

## Test Scenarios

### S1: Happy Path — Tạo phòng ban cơ bản

**Steps**:
1. Gửi POST /api/v1/departments với body:
   `json
   { "departmentCode": "IT", "departmentName": "Phòng Công nghệ thông tin" }
   `
2. Nhận response 201.

**Verify**:
- [ ] Response có success: true
- [ ] data.id là uuid hợp lệ
- [ ] data.departmentCode === "IT"
- [ ] data.departmentName === "Phòng Công nghệ thông tin"
- [ ] data.isActive === true
- [ ] data.createdAt và data.updatedAt là ISO-8601 timestamptz
- [ ] Ghi audit_logs với action_type = 'create', entity_type = 'department'

### S2: Happy Path — Tạo phòng ban con

**Steps**:
1. Tạo department cha (S1).
2. Gửi POST /api/v1/departments với body:
   `json
   { "departmentCode": "DEV", "departmentName": "Phòng Phát triển", "parentDepartmentId": "<cha-uuid>" }
   `
3. Nhận response 201.

**Verify**:
- [ ] parentDepartmentId trả về đúng uuid cha

### S3: Validation — Thiếu departmentCode

**Steps**:
1. Gửi POST với body: { "departmentName": "Test" }
2. Nhận response 400.

**Verify**:
- [ ] error.code === "VALIDATION_ERROR"

### S4: Validation — Empty departmentCode

**Steps**:
1. Gửi POST với body: { "departmentCode": "", "departmentName": "Test" }
2. Nhận response 400.

**Verify**:
- [ ] error.code === "VALIDATION_ERROR"

### S5: Validation — Whitespace-only departmentName

**Steps**:
1. Gửi POST với body: { "departmentCode": "TEST", "departmentName": "   " }
2. Nhận response 400.

**Verify**:
- [ ] error.code === "VALIDATION_ERROR"

### S6: Format — departmentCode sai pattern

**Steps**:
1. Gửi POST với body: { "departmentCode": "it dept", "departmentName": "Test" }
2. Nhận response 422.

**Verify**:
- [ ] error.code === "VALIDATION_ERROR"

### S7: Format — departmentCode có ký tự tiếng Việt

**Steps**:
1. Gửi POST với body: { "departmentCode": "PHÒNG_IT", "departmentName": "Test" }
   *Lưu ý: 'Ò' có dấu, không khớp regex [A-Z0-9]*
2. Nhận response 422.

### S8: Format — departmentCode < 2 ký tự

**Steps**:
1. Gửi POST với body: { "departmentCode": "A", "departmentName": "Test" }
2. Nhận response 422.

### S9: Format — departmentName chứa emoji

**Steps**:
1. Gửi POST với body: { "departmentCode": "TEST", "departmentName": "Test 😊" }
2. Nhận response 422.

### S10: Business Rule — DepartmentCode đã tồn tại

**Steps**:
1. Tạo department "IT" (S1).
2. Gửi POST lại với departmentCode "IT".
3. Nhận response 409.

**Verify**:
- [ ] error.code === "DEPARTMENT_ALREADY_EXISTS"

### S11: Business Rule — DepartmentName đã tồn tại

**Steps**:
1. Tạo department với name "Phòng Công nghệ thông tin" (S1).
2. Gửi POST lại với departmentName "Phòng Công nghệ thông tin".
3. Nhận response 409.

### S12: Authorization — Không JWT

**Steps**:
1. Gửi POST /api/v1/departments không có Authorization header.
2. Nhận response 401.

### S13: Authorization — Thiếu permission

**Steps**:
1. Lấy JWT của user không có quyền department.create.
2. Gửi POST → 403.

### S14: Reference — parentDepartmentId không tồn tại

**Steps**:
1. Gửi POST với non-existent uuid → 404.

### S15: Reference — managerUserId không active

**Steps**:
1. Gửi POST với userId đã bị inactive → 404.

### S16: Hierarchy — Circular reference (guard logic)

**Steps**:
1. Tạo department A (id = "dept-a-uuid").
2. Gửi POST tạo department B với `parentDepartmentId = "dept-a-uuid"` và trong service logic, check ancestors của A. Nếu A.parentDepartmentId trỏ về B (sau khi B được tạo) thì đó là circular ref — nhưng với create, circular ref guard là defensive check cho future update.
3. Trong phạm vi create department, circular ref chỉ xảy ra nếu có bug trong parent lookup chain. Guard vẫn được implement để phòng ngừa.
4. Expected: Nếu parentDepartmentId trỏ đến chính department đang tạo (self-reference detect) → 422.

*Note: đây là guard logic cho update hierarchy sau này; với create thuần, circular ref khó xảy ra vì record chưa tồn tại.*

### S17: Hierarchy — Depth > 5 levels

**Steps**: Tạo chain 5 departments, level 6 → 422.

### S18: Audit — Tạo thành công ghi audit log

**Steps**:
1. Tạo department thành công.
2. Query audit_logs → có record với action_type = 'create'.

---

## Verification Checklist (Post-Implementation)

- [ ] DepartmentEntity có cập nhật unique constraints + partial indexes
- [ ] CreateDepartmentDto có class-validator decorators cho regex, length, trim
- [ ] DepartmentsController dùng JwtAuthGuard + PermissionsGuard
- [ ] Permission department.create được seed cho ADMIN và MANAGER roles
- [ ] DepartmentsService.createDepartment dùng transaction + audit log
- [ ] Race condition handling: app check + DB constraint → 409
- [ ] API response format { success, message, data } thống nhất
- [ ] Swagger docs đầy đủ cho endpoint mới

