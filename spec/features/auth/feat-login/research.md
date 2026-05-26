# Research: AUTH-001 Login

## Decision 1: Strict body validation overrides optional rememberDevice from quick reference
- Decision: Chỉ chấp nhận `email` và `password` trong request body login.
- Rationale: Đây là clarification mới nhất đã được chốt trong spec; cho phép `rememberDevice` sẽ làm lệch acceptance criteria và error handling.
- Alternatives considered: Giữ `rememberDevice` là optional theo API quick reference, nhưng bị loại vì trái với clarified scope.

## Decision 2: Session must persist before token issuance
- Decision: Insert `user_sessions` trước khi tạo access token và refresh token.
- Rationale: Spec chốt `AUTH_SESSION_CREATE_FAILED` là blocker và login success chỉ hợp lệ khi session đã được persist.
- Alternatives considered: Generate token trước rồi mới persist session, nhưng bị loại vì tạo ra state không nhất quán khi session write fail.

## Decision 3: last_login_at and audit log are non-blocking side effects
- Decision: `users.last_login_at` update và `audit_logs` insert chạy sau success path chính và không làm fail login nếu lỗi.
- Rationale: Phù hợp clarification đã chốt, giảm rollback không cần thiết cho các side effects quan sát được.
- Alternatives considered: Đưa các bước này vào transaction/blocking path, nhưng bị loại vì trái nghiệp vụ đã chốt.

## Decision 4: Token generation failure requires session cleanup/revoke
- Decision: Nếu token generation fail sau khi session insert thành công, implementation phải cleanup hoặc revoke session vừa tạo.
- Rationale: Giữ consistency giữa session persistence và token issuance.
- Alternatives considered: Để session tồn tại và rely vào cleanup background, nhưng bị loại vì tăng risk session mồ côi.
