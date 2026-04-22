# PROJECT CONSTITUTION - Smart Meeting Management & AI Meeting Intelligence Platform
# Version: 1.0.0
# Status: LOCKED
# Áp dụng cho : ALL AI AGENT, ALL DEVELOPER, ALL MEMBER
# Owner: Tech Lead / Architecture Owner / Product Engineering Lead
# Amendment Process: mọi thay đổi phải qua RFC + version bump
# Precedence Order: Constitution > ADR > feature spec > implementation notes
# Exception/Waiver Policy: chỉ áp dụng với Layer 2/3, không áp dụng với Layer 1

--------------------------------------------
    LAYER 1 : HARD RULES
--------------------------------------------

## SEC-01 : Bảo mật thông tin 
THE system SHALL NOT Lưu bất kì secret nào dưới dạng plaintext trong source code, config file, hoặc logs.
Áp dụng cho: API keys, passwords, tokens, PII, NHNN data.
Enforcement: Secret scanning SHALL run in both local pre-commit and CI pipelines. Pre-commit hooks are advisory; CI is the final enforcement gate.

## SEC-02 : Authentication bắt buộc 
THE system SHALL yêu cầu xác thực cho mọi endpoint thay đổi dữ liệu(POST, PUT, PATCH, DELETE).
Every protected endpoint SHALL enforce authorization checks based on role and resource ownership.
Ngoại lệ là các public endpoints phải được document rõ lý do.

## SEC-03 : Input validation 
THE system SHALL validate và sanitize tất cả user input trước khi xử lý và lưu vào database.
KHông có raw SQL, query với user input không được parameterize.

## DATA-01 : Không xóa dữ liệu vĩnh viễn
THE system SHALL dùng soft-delete (delete_at) thay vì hard-delete cho mọi entity business-critical.
Hard-delete chỉ được phép cho: logs > 90 ngày, temp files.

--------------------------------------------
    LAYER 2: ARCHITECTURAL CONSTRAINTS
--------------------------------------------

## ARCH-01: Service boundary
Services SHALL giao tiếp qua API contracts (REST/gRPC/events).
Direct DB access từ service khác là PROHIBITED.
Exception process : RFC trong .sdd/sfcs/ + tech lead sign-off.

## ARCH-02: Event-driven cho async operations 
Operations expected to exceed 2 seconds under normal load, or involving long-running I/O, AI processing, media processing, or batch work, SHALL be executed asynchronously via queue/job worker unless explicitly approved in an ADR.
Sync HTTP call với timeout > 2s là architectural violation.

## ARCH-03: Idempotency
Mọi mutating API endpoint SHALL có idempotency mechanism(idempotency-key header hoặc natural idempotency design).

--------------------------------------------
    LAYER 3: ENGINEERING STANDARS 
--------------------------------------------

## ENG-01: Test coverage
Minimum test coverage: 80% cho business logic.
Exception: proof-of-concept branches (cần xóa trước khi merge main).

## ENG-02: Documentation 
Mọi public API endpoin SHALL có OpenAPI documentation.
Mọi business rule SHALL có EARS tag trong code documents.

## ENG-03: Error handling
THE system SHALL không expose internal error details ra client.
Error response format : {error_code, message, request_id}.
Stack trace SHALL chỉ xuất hiện trong server logs, không response.

## ENG-04: Dependency
Third-party libary SHALL được pin version cụ thể.
Major version update cần security review.

--------------------------------------------
    AI AGENT SELF-CHECK PROTOCOL
--------------------------------------------

## Trước khi submit bất ky code nào, AI phải self-check:

CHECKLIST SEC:
    [ ] Không có hardcoded secrets (grep: password=, key=, token=)
    [ ] Mọi endpoint mutating có auth middleware.
    [ ] Input validation present trước DB operations.

CHECKLIST ARCH:
    [ ] Không có cross-service DB access.
    [ ] Async operations > 2s dùng queue.
    [ ] Mutating endpoints có idempotency.a

CHECKLIST ENG: 
    [ ] Unit tests cover happy path + error cases.
    [ ] EARS tags trong code comments.
    [ ] Error responses không chứa stack trace.

## Nếu vi phạm phát hiện: 
AI SHALL báo cáo: "[CONSTITUTION VIOLATION] Rule: {ID} File : {file}, line: {n}, Action taken: {description}."
AI SHALL không submit code vi phạm layer 1.
AI SHALL hỏi human approval cho layer 2 violations.