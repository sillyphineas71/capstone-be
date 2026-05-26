# Implementation Plan: UC-AM-01 Create New Account

**Branch**: `tai-branch` | **Date**: 2026-04-24 | **Spec**: [spec.md](/home/duktai/Desktop/capstone-be/spec/features/account/feat-create-account/spec.md)
**Input**: Feature specification from `/spec/features/account/feat-create-account/spec.md`

## 1. Feature Summary

Feature này triển khai UC-AM-01 cho phép `Administrator` tạo mới internal account qua `POST /api/v1/accounts`, với các yêu cầu cốt lõi: kiểm soát permission ở mức use-case, validate dữ liệu đầu vào, auto-generate `username`, sinh `temporary password`, lưu `users` + `user_roles` + `audit_logs` trong cùng transaction, đặt trạng thái `ACTIVE`, bật `force_change_password = true`, và trigger email provisioning bất đồng bộ. Khi email fail, account vẫn được giữ nguyên và API/luồng quản trị phải trả về warning rõ ràng; recovery flow nằm ngoài scope.

## 2. Technical Context

**Language/Version**: TypeScript on NestJS 16  
**Primary Dependencies**: NestJS, class-validator/class-transformer, PostgreSQL 18, Brevo email API  
**Storage**: PostgreSQL 18  
**Testing**: Jest, Nest testing utilities, Supertest cho e2e/integration API  
**Target Platform**: Linux server backend API  
**Project Type**: Backend web-service (modular monolith theo module boundaries)  
**Performance Goals**: API create account `< 500ms` không tính thời gian gửi email async  
**Constraints**: Không lưu plaintext password ở DB/log/cache/queue/API response; không mở rộng sang recovery flow; chỉ 1 role chính tại thời điểm tạo; chỉ reuse lookup API sẵn có  
**Scale/Scope**: 1 create-account endpoint, tác động trực tiếp tới `users`, `user_roles`, `audit_logs`, tích hợp notification bất đồng bộ

## 3. Scope Confirmation

Trong scope:
- `POST /api/v1/accounts` cho `Administrator`.
- Authorization bằng permission chính `accounts:create` hoặc `accounts:write`.
- Role assignment boundary bằng whitelist role được phép gán.
- Validate required fields, format rules, unique rules, invalid reference rules.
- Auto-generate unique `username` theo `short_name_base + random_4_digits`, retry tối đa 10 lần.
- Sinh temporary password trong memory, hash trước khi lưu.
- Ghi `users`, `user_roles`, `audit_logs` trong cùng transaction.
- Set `status = ACTIVE` và `force_change_password = true`.
- Trigger email provisioning async; nếu fail thì trả warning nhưng không rollback account.

Ngoài scope:
- Resend Initial Credential / Regenerate Temporary Password.
- First-login flow hoặc login implementation thực tế.
- Tạo `user_profiles` trong UC này.
- Department boundary theo phạm vi quản lý.
- Event publishing `account.created` như yêu cầu bắt buộc của core flow.
- Mở rộng lookup API mới nếu API hiện có đã đáp ứng.

## 4. Data Model Impact

**Database impact**

Tác động chính:
- `users`
  - Insert mới record account.
  - Required logical fields: `full_name`, `employee_code`, `email`, `username`, `password_hash`, `department_id`, `status`, `force_change_password`, `created_by`, `updated_by`.
  - `status` mặc định là `ACTIVE`.
  - `force_change_password` là `boolean`, set `true` khi tạo mới.
  - `department_id` là FK tới `departments.id`.
- `user_roles`
  - Insert đúng 1 role chính cho account mới.
- `audit_logs`
  - Ghi lại actor, thời gian, account được tạo, kết quả xử lý.

**Schema/constraint impact cần xác nhận trong implementation**
- Unique constraint ở DB cho `users.email`, `users.username`, `users.employee_code`.
- Có cột `force_change_password boolean` trong `users`; nếu chưa có thì cần migration.
- `employee_code` chuẩn hóa uppercase trước khi validate/lưu để khớp regex `^[A-Z0-9]{4,20}$`.
- `email` lowercase trước khi lưu để tránh duplicate logic khác biệt giữa app và DB.

**Transaction boundary**

Một transaction DB bao gồm:
- Validate references cuối cùng tại server.
- Insert `users`.
- Insert `user_roles`.
- Insert `audit_logs` thành công-path.

Không nằm trong transaction DB:
- Gửi email Brevo.
- Recovery flow khi email fail.

## 5. API / Contract Plan

**Primary endpoint**
- `POST /api/v1/accounts`

**Contract direction so với module API hiện tại**
- Cần align lại contract UC-AM-01 hiện có trong [spec/modules/account/api.md](/home/duktai/Desktop/capstone-be/spec/modules/account/api.md:261):
  - `username` không còn là request field do admin nhập.
  - `employeeCode` chuyển từ optional thành required.
  - `roleIds` cần thu hẹp về đúng 1 role chính tại thời điểm tạo. Có thể dùng `roleId` hoặc chấp nhận `roleIds` với đúng 1 phần tử; plan ưu tiên contract rõ ràng bằng `roleId` để tránh mơ hồ.
  - `departmentId` là optional trong UC-AM-01; nếu client gửi thì backend phải validate department tồn tại và còn active.
  - Response không bao giờ trả plaintext temporary password.
  - Khi email fail cần có response shape hỗ trợ warning hoặc success-with-warning rõ ràng.

**Planned request body**
```json
{
  "employeeCode": "EMP0012",
  "fullName": "Nguyen Thi Thanh",
  "email": "thanh.nguyen@company.com",
  "phoneNumber": "+84901234567",
  "departmentId": "dep_01",
  "roleId": "role_manager"
}
```

**Planned success response**
- `201 Created` với account summary đã tạo gồm `id`, `employeeCode`, `username`, `fullName`, `email`, `status`, `department`, `role`, `createdAt`.
- Có cờ hoặc message phản ánh provisioning notification status nếu email được dispatch thành công hay bị warning.

**Planned error contract**
- Duplicate:
  - `DUPLICATE_EMAIL`
  - `DUPLICATE_USERNAME`
  - `DUPLICATE_EMPLOYEE_CODE`
- Reference/authorization:
  - `INVALID_ROLE_SELECTION`
  - `INVALID_DEPARTMENT_SELECTION`
  - `ROLE_ASSIGNMENT_NOT_ALLOWED` nếu role không nằm trong whitelist
  - `FORBIDDEN` nếu actor không có permission chính
- Generation/validation:
  - `USERNAME_GENERATION_FAILED`
  - `INVALID_PHONE_NUMBER`
  - `INVALID_EMPLOYEE_CODE`
  - standard field-level validation errors cho required/format

## 6. Authorization Plan

- Route guard yêu cầu actor là `Administrator` và có permission chính `accounts:create` hoặc `accounts:write`.
- Authorization không yêu cầu tập permission nhỏ lẻ như `account.assign_role`, `account.active`.
- Trong service layer vẫn bắt buộc check boundary rule cho role assignment:
  - role được chọn phải nằm trong whitelist role mà actor được phép gán.
  - nếu không thỏa, fail sớm với error code rõ ràng.
- Department boundary không áp dụng trong feature này, nhưng `departmentId` vẫn phải tham chiếu một department còn hiệu lực.
- Authorization check cần diễn ra trước transaction write; boundary validation cho role/department cần được re-check tại server ngay trước insert.

## 7. Business Logic Plan

Luồng xử lý đề xuất:
1. Authenticate request và authorize bằng permission chính.
2. Validate payload theo DTO + business rules.
3. Normalize input:
   - lowercase `email`
   - trim/collapse spaces cho `fullName`
   - uppercase `employeeCode`
4. Load và verify `department` còn hiệu lực.
5. Load `role` và verify role thuộc whitelist assignable của actor.
6. Generate `username` từ `short_name_base + random_4_digits`.
7. Retry generation tối đa 10 lần khi đụng unique conflict.
8. Generate temporary password trong memory và hash trước khi persist.
9. Mở DB transaction để insert `users`, `user_roles`, `audit_logs`.
10. Commit transaction với `status = ACTIVE`, `force_change_password = true`.
11. Sau commit, dispatch gửi email provisioning bất đồng bộ.
12. Nếu email dispatch thành công, trả `201 Created` success.
13. Nếu email dispatch fail, vẫn trả kết quả tạo account thành công kèm warning rõ ràng để Administrator biết recovery flow thuộc use case khác.

Quyết định nghiệp vụ cần phản ánh rõ trong code/design:
- Mỗi account mới chỉ có 1 role chính tại thời điểm tạo.
- Account readiness được xem là đạt ngay sau khi DB commit thành công, không phụ thuộc vào login integration.
- Không lưu plaintext temporary password ở bất kỳ persistence/storage trung gian nào.

## 8. Validation Plan

**Required fields**
- `fullName`
- `employeeCode`
- `email`
- `roleId`

**Optional fields**
- `phoneNumber`
- `departmentId`; nếu được cung cấp thì backend phải validate department tồn tại và còn hiệu lực/active.

**Format/normalization rules**
- `employeeCode`: uppercase alphanumeric, regex `^[A-Z0-9]{4,20}$`
- `email`: valid email, lowercase trước khi lưu
- `phoneNumber`: regex `^\+?[0-9]{10,15}$`
- `fullName`: trim + collapse spaces
- `username`: system-generated + normalized, không nhận từ client

**Uniqueness rules**
- `email` unique toàn hệ thống
- `username` unique toàn hệ thống
- `employeeCode` unique toàn hệ thống

**Reference validation**
- `roleId` phải được re-check trước khi insert để bảo đảm role tồn tại, còn hiệu lực, và nằm trong whitelist assignable của actor
- `departmentId` nếu có phải được re-check trước khi insert để bảo đảm department tồn tại và còn hiệu lực

**Consistency checks**
- Validation tầng DTO để fail sớm với lỗi field-level.
- Validation tầng service/repository để handle stale data, race condition, DB unique conflicts.
- Stale reference re-check cho `roleId` và `departmentId` phải diễn ra ngay trước transaction write hoặc bên trong transaction boundary.

## 9. Error Handling Plan

**Validation errors**
- Trả lỗi field-level rõ ràng cho required/format sai.
- `INVALID_EMPLOYEE_CODE` cho regex sai.
- `INVALID_PHONE_NUMBER` cho phone format sai.

**Business errors**
- `DUPLICATE_EMAIL`, `DUPLICATE_USERNAME`, `DUPLICATE_EMPLOYEE_CODE`.
- `USERNAME_GENERATION_FAILED` với field `username` và message `Unable to generate a unique username. Please try again.` sau 10 lần retry không thành công.
- `INVALID_ROLE_SELECTION`, `INVALID_DEPARTMENT_SELECTION` khi reference không hợp lệ hoặc inactive tại thời điểm submit.
- `ROLE_ASSIGNMENT_NOT_ALLOWED` khi role có tồn tại nhưng ngoài whitelist của actor.

**Transactional failure handling**
- Nếu fail ở `users`, `user_roles`, hoặc `audit_logs` thì rollback toàn bộ transaction.
- Unique conflict từ DB phải được map lại về business error tương ứng theo field bị vi phạm, kể cả khi pre-check trước đó đã pass.

**Notification failure handling**
- Gửi email nằm ngoài transaction.
- Nếu Brevo/email dispatch fail sau commit, account vẫn tồn tại, API trả success-with-warning hoặc success có warning metadata.
- Không expose temporary password ở warning path.

## 10. Testing Strategy

**Unit tests**
- Username generation service:
  - tạo đúng `short_name_base + random_4_digits`
  - normalize tiếng Việt / khoảng trắng theo rule chọn trong implementation
  - retry tối đa 10 lần
  - throw `USERNAME_GENERATION_FAILED` khi exhaust retries
- Validation helpers:
  - normalize `fullName`, `email`, `employeeCode`
  - validate regex `employeeCode`, `phoneNumber`
- Authorization policy:
  - pass khi có `accounts:create` hoặc `accounts:write`
  - fail khi role ngoài whitelist

**Integration tests**
- Service + repository + DB transaction:
  - tạo thành công `users` + `user_roles` + `audit_logs`
  - rollback khi insert `user_roles` hoặc `audit_logs` fail
  - map unique violation DB sang error code tương ứng
  - invalid role/department ở thời điểm submit trả error code đúng

**API/e2e tests**
- `POST /api/v1/accounts` success path.
- Forbidden path khi không có permission chính.
- Validation error path cho required/format.
- Duplicate path cho `email`, `username`, `employeeCode`.
- Contract verification path để bảo đảm implementation khớp với `contracts/create-account.openapi.yaml` cho request body, success response, validation errors, duplicate errors, invalid role/department errors, `USERNAME_GENERATION_FAILED`, và email failure warning behavior.
- Email async fail path: account vẫn tạo thành công, response có warning.

**Acceptance coverage check**
- Mỗi acceptance criterion phải có ít nhất một test hoặc verification point tương ứng trong unit/integration/e2e.
- Test coverage ưu tiên correctness cho validation, authorization, transaction boundary, và warning path.

## 11. Implementation Phases

**Phase 1: Contract & schema alignment**
- Chốt `POST /api/v1/accounts` contract delta với spec feature.
- Thêm/cập nhật schema DB nếu thiếu `force_change_password` hoặc constraints cần thiết.
- Chuẩn hóa error code catalog cho UC-AM-01.

**Phase 2: Foundational backend structure**
- Tạo `src/modules/accounts` structure gồm controller, dto, service, repository, policy/guard integration, mapper, notifier port.
- Tạo reusable helpers cho normalization, username generation, password bootstrap.

**Phase 3: Core create-account flow**
- Implement DTO validation.
- Implement authorization + whitelist role assignment.
- Implement transactional write cho `users`, `user_roles`, `audit_logs`.
- Implement DB error mapping.

**Phase 4: Notification and response semantics**
- Integrate Brevo notification async.
- Trả success / success-with-warning rõ ràng.
- Đảm bảo không rò rỉ plaintext temporary password.

**Phase 5: Verification & hardening**
- Hoàn thiện unit/integration/e2e tests.
- Kiểm tra SLA logic ở mức synchronous path.
- Soát consistency giữa spec, module API contract, và implementation.

## 12. Risks & Mitigations

- **Risk**: Mâu thuẫn giữa feature spec và module API hiện tại (`username`, `employeeCode`, `roleIds`).  
  **Mitigation**: Cập nhật contract artifact riêng cho feature và dùng nó làm nguồn cho tasks/implementation.

- **Risk**: Unique race condition sau pre-check.  
  **Mitigation**: Dựa vào DB unique constraint là nguồn sự thật cuối cùng và map exception về business error code.

- **Risk**: Logic generate username không deterministic với tên tiếng Việt có dấu.  
  **Mitigation**: Cô lập thành helper/service có test cases rõ cho transliteration/normalization.

- **Risk**: Email async fail làm admin hiểu nhầm account chưa dùng được.  
  **Mitigation**: Response/message phải phân biệt rõ “account created” và “notification warning”; recovery flow được nêu rõ là use case khác.

- **Risk**: Authorization chỉ check scope nhưng bỏ sót whitelist role assignment.  
  **Mitigation**: Tách riêng policy check cho assignable role và viết integration tests bắt buộc.

- **Risk**: Tăng schema impact ngoài scope.  
  **Mitigation**: Chỉ thêm/cập nhật các cột/constraint trực tiếp phục vụ UC-AM-01, không đụng `user_profiles` hay flow khác.

## 13. Acceptance Criteria Traceability

| Acceptance Criteria | Plan Coverage |
|---|---|
| Only Administrator có quyền tạo mới account | Sections 5, 6, 10 |
| Form hỗ trợ nhập đủ dữ liệu và validate đúng | Sections 5, 8, 10 |
| Username auto-generate + normalize + retry 10 lần | Sections 7, 8, 9, 10 |
| Chỉ role nằm trong whitelist mới được gán | Sections 6, 7, 10 |
| `employee_code` required + unique + regex đúng | Sections 4, 8, 10 |
| Invalid role/department trả đúng error code | Sections 5, 8, 9, 10 |
| Account được tạo trong `users`, gán role qua `user_roles`, trạng thái `ACTIVE` | Sections 4, 7, 10 |
| Password được hash và bắt buộc đổi lần đầu | Sections 4, 7, 10 |
| Hệ thống gửi email hoặc warning nếu gửi thất bại | Sections 7, 9, 10 |
| Email fail vẫn giữ account, recovery ngoài scope | Sections 3, 7, 9, 10 |
| Account readiness đạt sau create thành công | Sections 3, 7, 10 |
| Account mới được persist thành công và có thể truy vấn lại qua Account List API | Sections 4, 5, 7, 10 |

## Constitution Check

**Pre-Phase 0**
- Spec-first: PASS. Plan bám theo [spec.md](/home/duktai/Desktop/capstone-be/spec/features/account/feat-create-account/spec.md) và clarification đã chốt.
- Scope control: PASS. Không kéo recovery flow, login flow, `user_profiles`, hay feature ngoài UC-AM-01 vào implementation core.
- Testability: PASS. Có chiến lược unit/integration/e2e theo acceptance criteria.
- Architecture consistency: PASS. Phù hợp backend NestJS + PostgreSQL + modular module `accounts`.

**Post-Design re-check**
- Database impact: PASS, giới hạn ở `users`, `user_roles`, `audit_logs` và cột `force_change_password` nếu thiếu.
- API contract consistency: PASS, đã nêu rõ contract delta cần align.
- Authorization completeness: PASS, tách scope check và whitelist boundary.
- Transaction boundary clarity: PASS, DB writes trong transaction, email ngoài transaction.

## Project Structure

### Documentation (this feature)

```text
spec/features/account/feat-create-account/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── create-account.openapi.yaml
```

### Source Code (repository root)

```text
src/
├── app.module.ts
├── main.ts
└── modules/
    └── accounts/
        ├── accounts.module.ts
        ├── controllers/
        ├── dto/
        ├── services/
        ├── repositories/
        ├── policies/
        ├── mappers/
        └── integrations/

test/
├── app.e2e-spec.ts
└── accounts/
    ├── unit/
    ├── integration/
    └── e2e/
```

**Structure Decision**: Sử dụng backend NestJS module structure dưới `src/modules/accounts` vì repo hiện là backend service và chưa có implementation cụ thể cho `accounts` trong `src/`.
